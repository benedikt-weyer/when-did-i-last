use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    domains::{
        auth::AuthenticatedUser,
        folders::service,
        notes::controller::{EncryptedBlobRequest, WrappedDekRequest},
    },
    error::AppResult,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_folders).post(create_folder))
        .route(
            "/{folder_id}",
            axum::routing::put(update_folder).delete(delete_folder),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveFolderRequest {
    encrypted_deks: Vec<WrappedDekRequest>,
    encrypted_payload: EncryptedBlobRequest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderResponse {
    id: Uuid,
    encrypted_dek: WrappedDekResponse,
    encrypted_payload: EncryptedBlobResponse,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedBlobResponse {
    algorithm: String,
    ciphertext_hex: String,
    nonce_hex: String,
    version: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WrappedDekResponse {
    algorithm: String,
    kem_ciphertext_hex: String,
    kek_public_key: String,
    nonce_hex: String,
    user_id: Uuid,
    version: i32,
    wrapped_dek_hex: String,
}

async fn list_folders(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> AppResult<Json<Vec<FolderResponse>>> {
    Ok(Json(
        service::list_folders(&state, &user)
            .await?
            .into_iter()
            .map(map_folder)
            .collect(),
    ))
}

async fn create_folder(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(payload): Json<SaveFolderRequest>,
) -> AppResult<Json<FolderResponse>> {
    Ok(Json(map_folder(
        service::save_folder(&state, &user, None, map_command(payload)).await?,
    )))
}

async fn update_folder(
    State(state): State<AppState>,
    Path(folder_id): Path<Uuid>,
    user: AuthenticatedUser,
    Json(payload): Json<SaveFolderRequest>,
) -> AppResult<Json<FolderResponse>> {
    Ok(Json(map_folder(
        service::save_folder(&state, &user, Some(folder_id), map_command(payload)).await?,
    )))
}

async fn delete_folder(
    State(state): State<AppState>,
    Path(folder_id): Path<Uuid>,
    user: AuthenticatedUser,
) -> AppResult<Json<bool>> {
    service::delete_folder(&state, &user, folder_id).await?;
    Ok(Json(true))
}

fn map_command(payload: SaveFolderRequest) -> crate::domains::notes::service::SaveNoteCommand {
    crate::domains::notes::service::SaveNoteCommand {
        encrypted_deks: payload
            .encrypted_deks
            .into_iter()
            .map(
                |dek| crate::domains::notes::service::SaveWrappedDekCommand {
                    algorithm: dek.algorithm,
                    kem_ciphertext_hex: dek.kem_ciphertext_hex,
                    kek_public_key: dek.kek_public_key,
                    nonce_hex: dek.nonce_hex,
                    user_id: dek.user_id,
                    version: dek.version,
                    wrapped_dek_hex: dek.wrapped_dek_hex,
                },
            )
            .collect(),
        encrypted_payload: crate::domains::notes::service::SaveEncryptedBlobCommand {
            algorithm: payload.encrypted_payload.algorithm,
            ciphertext_hex: payload.encrypted_payload.ciphertext_hex,
            nonce_hex: payload.encrypted_payload.nonce_hex,
            version: payload.encrypted_payload.version,
        },
    }
}

fn map_folder(folder: service::StoredFolder) -> FolderResponse {
    FolderResponse {
        id: folder.id,
        encrypted_dek: WrappedDekResponse {
            algorithm: folder.encrypted_dek.algorithm,
            kem_ciphertext_hex: folder.encrypted_dek.kem_ciphertext_hex,
            kek_public_key: folder.encrypted_dek.kek_public_key,
            nonce_hex: folder.encrypted_dek.nonce_hex,
            user_id: folder.encrypted_dek.user_id,
            version: folder.encrypted_dek.version,
            wrapped_dek_hex: folder.encrypted_dek.wrapped_dek_hex,
        },
        encrypted_payload: EncryptedBlobResponse {
            algorithm: folder.encrypted_payload.algorithm,
            ciphertext_hex: folder.encrypted_payload.ciphertext_hex,
            nonce_hex: folder.encrypted_payload.nonce_hex,
            version: folder.encrypted_payload.version,
        },
        created_at: folder.created_at,
        updated_at: folder.updated_at,
    }
}
