use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    app_state::AppState,
    domains::{
        auth::{AuthenticatedUser, PrincipalKind},
        health::service::{self, ResourceKind},
    },
    error::AppResult,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/health", get(get_e2ee_health))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E2eeHealthResponse {
    linked_principals: Vec<LinkedPrincipalResponse>,
    resources: Vec<ResourceHealthResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedPrincipalResponse {
    id: Uuid,
    kind: PrincipalKind,
    email: Option<String>,
    username: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceHealthResponse {
    resource_id: Uuid,
    resource_kind: ResourceKind,
    updated_at: String,
    recipient_principal_ids: Vec<Uuid>,
    missing_principal_ids: Vec<Uuid>,
}

pub async fn get_e2ee_health(
    State(state): State<AppState>,
    authenticated_user: AuthenticatedUser,
) -> AppResult<Json<E2eeHealthResponse>> {
    let health = service::get_e2ee_health(&state, &authenticated_user).await?;

    Ok(Json(E2eeHealthResponse {
        linked_principals: health
            .linked_principals
            .into_iter()
            .map(|principal| LinkedPrincipalResponse {
                id: principal.id,
                kind: principal.kind,
                email: principal.email,
                username: principal.username,
            })
            .collect(),
        resources: health
            .resources
            .into_iter()
            .map(|resource| ResourceHealthResponse {
                resource_id: resource.resource_id,
                resource_kind: resource.resource_kind,
                updated_at: resource.updated_at,
                recipient_principal_ids: resource.recipient_principal_ids,
                missing_principal_ids: resource.missing_principal_ids,
            })
            .collect(),
    }))
}
