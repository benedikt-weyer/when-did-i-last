use std::collections::HashSet;

use serde::Serialize;
use uuid::Uuid;

use crate::{
    app_state::AppState,
    domains::{
        auth::{self, AuthenticatedUser, service::LinkedPrincipal},
        folders,
        notes::repository as notes_repository,
    },
    error::AppResult,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Card,
    Folder,
}

pub struct ResourceHealth {
    pub resource_id: Uuid,
    pub resource_kind: ResourceKind,
    pub updated_at: String,
    pub recipient_principal_ids: Vec<Uuid>,
    pub missing_principal_ids: Vec<Uuid>,
}

pub struct E2eeHealth {
    pub linked_principals: Vec<LinkedPrincipal>,
    pub resources: Vec<ResourceHealth>,
}

pub async fn get_e2ee_health(
    state: &AppState,
    authenticated_user: &AuthenticatedUser,
) -> AppResult<E2eeHealth> {
    let linked_principals = auth::service::list_linked_principals(state, authenticated_user).await?;
    let linked_principal_ids: HashSet<Uuid> =
        linked_principals.iter().map(|principal| principal.id).collect();

    let notes = notes_repository::list_notes_for_owner(&state.db, authenticated_user.owner_user_id)
        .await?;
    let folders =
        folders::service::list_folders_for_owner(&state.db, authenticated_user.owner_user_id)
            .await?;

    let mut resources = Vec::with_capacity(notes.len() + folders.len());

    for note in notes {
        resources.push(
            build_resource_health(state, note.id, ResourceKind::Card, note.updated_at.to_rfc3339(), &linked_principal_ids)
                .await?,
        );
    }

    for folder in folders {
        resources.push(
            build_resource_health(
                state,
                folder.id,
                ResourceKind::Folder,
                folder.updated_at.to_rfc3339(),
                &linked_principal_ids,
            )
            .await?,
        );
    }

    Ok(E2eeHealth {
        linked_principals,
        resources,
    })
}

async fn build_resource_health(
    state: &AppState,
    resource_id: Uuid,
    resource_kind: ResourceKind,
    updated_at: String,
    linked_principal_ids: &HashSet<Uuid>,
) -> AppResult<ResourceHealth> {
    let recipient_principal_ids =
        notes_repository::list_note_recipient_ids(&state.db, resource_id).await?;
    let recipient_set: HashSet<Uuid> = recipient_principal_ids.iter().copied().collect();
    let missing_principal_ids = linked_principal_ids
        .iter()
        .filter(|principal_id| !recipient_set.contains(principal_id))
        .copied()
        .collect();

    Ok(ResourceHealth {
        resource_id,
        resource_kind,
        updated_at,
        recipient_principal_ids,
        missing_principal_ids,
    })
}
