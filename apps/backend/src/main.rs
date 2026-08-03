mod app_state;
mod config;
mod db;
mod domains;
mod error;

use std::{net::SocketAddr, time::Duration};

use axum::{routing::get, Router};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
use sea_orm_migration::MigratorTrait;
use tokio::sync::broadcast;
use tokio::time::sleep;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{info, warn};

use crate::{
    app_state::AppState,
    config::Config,
    db::migrations::Migrator,
    error::{AppError, AppResult},
};

const DATABASE_CONNECT_RETRY_DELAY: Duration = Duration::from_secs(2);

#[tokio::main]
async fn main() -> AppResult<()> {
    dotenvy::dotenv().ok();
    init_tracing();

    let config = Config::from_env()?;
    let db = wait_for_database(&config.database_url).await?;
    let (note_events, _) = broadcast::channel(256);

    Migrator::up(&db, None).await.map_err(|error| {
        AppError::internal(format!("failed to run database migrations: {error}"))
    })?;

    let state = AppState {
        config,
        db,
        note_events,
    };

    let app = Router::new()
        .route("/health", get(domains::system::health))
        .nest("/api/auth", domains::auth::router())
        .nest("/api/cards", domains::notes::router())
        .nest("/api/folders", domains::folders::router())
        .nest("/api/e2ee", domains::health::router())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    let (listener, bound_addr) = bind_listener(state.config.bind_addr).await?;

    info!(address = %bound_addr, "backend listening");

    if cfg!(debug_assertions) {
        write_dev_backend_url(bound_addr);
    }

    axum::serve(listener, app)
        .await
        .map_err(|_| AppError::internal("backend server terminated unexpectedly"))?;

    Ok(())
}

/// Binds the configured address. In dev builds, if the port is already taken
/// (common when multiple sibling projects claim the same default port),
/// scans forward for the next free port on the same host instead of failing
/// to start. Release builds bind strictly, since silently drifting ports in
/// production would hide a real deployment conflict.
async fn bind_listener(desired_addr: SocketAddr) -> AppResult<(tokio::net::TcpListener, SocketAddr)> {
    if !cfg!(debug_assertions) {
        let listener = tokio::net::TcpListener::bind(desired_addr)
            .await
            .map_err(|_| AppError::internal("failed to bind the listening socket"))?;
        return Ok((listener, desired_addr));
    }

    let mut candidate_addr = desired_addr;

    loop {
        match tokio::net::TcpListener::bind(candidate_addr).await {
            Ok(listener) => {
                if candidate_addr.port() != desired_addr.port() {
                    warn!(
                        desired_port = desired_addr.port(),
                        bound_port = candidate_addr.port(),
                        "configured backend port was busy, switched to a free port"
                    );
                }
                return Ok((listener, candidate_addr));
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::AddrInUse
                    && candidate_addr.port() < u16::MAX =>
            {
                candidate_addr.set_port(candidate_addr.port() + 1);
            }
            Err(_) => return Err(AppError::internal("failed to bind the listening socket")),
        }
    }
}

/// Writes the resolved dev backend URL to a repo-root discovery file so the
/// web app's runtime-config route can pick up the actual port on every
/// request, regardless of how or in what order the backend and web dev
/// servers were started.
fn write_dev_backend_url(bound_addr: SocketAddr) {
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let run_dir = repo_root.join(".run");
    let backend_url = format!("http://127.0.0.1:{}", bound_addr.port());

    if let Err(error) = std::fs::create_dir_all(&run_dir) {
        warn!(error = %error, "failed to create .run directory for dev backend url discovery");
        return;
    }

    if let Err(error) = std::fs::write(run_dir.join("backend-url"), backend_url) {
        warn!(error = %error, "failed to write dev backend url discovery file");
    }
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backend=debug,tower_http=info".into()),
        )
        .compact()
        .init();
}

async fn wait_for_database(database_url: &str) -> AppResult<DatabaseConnection> {
    let mut attempt = 1_u32;

    loop {
        match Database::connect(database_url).await {
            Ok(db) => match ping_database(&db).await {
                Ok(()) => {
                    info!(attempt, "Postgres is online");
                    return Ok(db);
                }
                Err(error) => {
                    warn!(
                        attempt,
                        error = ?error,
                        retry_in_seconds = DATABASE_CONNECT_RETRY_DELAY.as_secs(),
                        "connected to Postgres but readiness check failed, retrying"
                    );
                }
            },
            Err(error) => {
                warn!(
                    attempt,
                    error = %error,
                    retry_in_seconds = DATABASE_CONNECT_RETRY_DELAY.as_secs(),
                    "waiting for Postgres to become available"
                );
            }
        }

        sleep(DATABASE_CONNECT_RETRY_DELAY).await;
        attempt += 1;
    }
}

async fn ping_database(db: &DatabaseConnection) -> AppResult<()> {
    db.query_one(Statement::from_string(
        DbBackend::Postgres,
        "select 1".to_owned(),
    ))
    .await
    .map_err(|_| AppError::internal("database health check failed"))?;

    Ok(())
}

pub async fn database_health(state: &AppState) -> AppResult<()> {
    ping_database(&state.db).await
}
