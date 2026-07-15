use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set,
    TransactionTrait,
};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    domains::{
        auth::AuthenticatedUser,
        folders::entity,
        notes::{repository, service as note_service},
    },
    error::{AppError, AppResult},
};

pub struct StoredFolder {
    pub created_at: String,
    pub encrypted_dek: note_service::StoredWrappedDek,
    pub encrypted_payload: note_service::StoredEncryptedBlob,
    pub id: Uuid,
    pub updated_at: String,
}

pub async fn list_folders(
    state: &AppState,
    user: &AuthenticatedUser,
) -> AppResult<Vec<StoredFolder>> {
    let folders = entity::Entity::find()
        .filter(entity::Column::UserId.eq(user.owner_user_id))
        .order_by_desc(entity::Column::UpdatedAt)
        .all(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to query folders"))?;

    let mut result = Vec::with_capacity(folders.len());
    for folder in folders {
        let dek = repository::find_wrapped_dek(&state.db, folder.id, user.principal_id)
            .await?
            .ok_or_else(|| AppError::internal("failed to query the folder dek"))?;
        result.push(map_folder(folder, dek));
    }
    Ok(result)
}

pub async fn save_folder(
    state: &AppState,
    user: &AuthenticatedUser,
    folder_id: Option<Uuid>,
    command: note_service::SaveNoteCommand,
) -> AppResult<StoredFolder> {
    note_service::validate_payload(&command)?;
    let now = Utc::now().fixed_offset();
    let transaction = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start the folder transaction"))?;
    let id = folder_id.unwrap_or_else(Uuid::now_v7);
    let existing = entity::Entity::find_by_id(id)
        .filter(entity::Column::UserId.eq(user.owner_user_id))
        .one(&transaction)
        .await
        .map_err(|_| AppError::internal("failed to query the folder"))?;
    let blob = note_service::map_save_blob(&command.encrypted_payload);
    let folder = if let Some(existing) = existing {
        let mut active: entity::ActiveModel = existing.into();
        active.algorithm = Set(blob.algorithm);
        active.ciphertext_hex = Set(blob.ciphertext_hex);
        active.nonce_hex = Set(blob.nonce_hex);
        active.version = Set(blob.version);
        active.updated_at = Set(now);
        active
            .update(&transaction)
            .await
            .map_err(|_| AppError::internal("failed to update the folder"))?
    } else {
        entity::ActiveModel {
            id: Set(id),
            user_id: Set(user.owner_user_id),
            algorithm: Set(blob.algorithm),
            ciphertext_hex: Set(blob.ciphertext_hex),
            nonce_hex: Set(blob.nonce_hex),
            version: Set(blob.version),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&transaction)
        .await
        .map_err(|_| AppError::internal("failed to create the folder"))?
    };

    repository::replace_wrapped_deks_for_resource(
        &transaction,
        id,
        note_service::map_wrapped_deks(&command.encrypted_deks)?,
        folder.created_at,
        now,
    )
    .await?;
    let dek = repository::find_wrapped_dek(&transaction, id, user.principal_id)
        .await?
        .ok_or_else(|| AppError::internal("failed to query the folder dek"))?;
    transaction
        .commit()
        .await
        .map_err(|_| AppError::internal("failed to commit the folder transaction"))?;
    Ok(map_folder(folder, dek))
}

pub async fn delete_folder(
    state: &AppState,
    user: &AuthenticatedUser,
    folder_id: Uuid,
) -> AppResult<()> {
    let folder = entity::Entity::find_by_id(folder_id)
        .filter(entity::Column::UserId.eq(user.owner_user_id))
        .one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to query the folder"))?
        .ok_or_else(|| AppError::not_found("folder not found"))?;
    let transaction = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start the folder transaction"))?;
    repository::delete_wrapped_deks_for_resource(&transaction, folder_id).await?;
    let active: entity::ActiveModel = folder.into();
    active
        .delete(&transaction)
        .await
        .map_err(|_| AppError::internal("failed to delete the folder"))?;
    transaction
        .commit()
        .await
        .map_err(|_| AppError::internal("failed to commit the folder transaction"))
}

pub async fn delete_folders_for_owner<C>(db: &C, owner_user_id: Uuid) -> AppResult<()>
where
    C: ConnectionTrait,
{
    let folder_ids = entity::Entity::find()
        .filter(entity::Column::UserId.eq(owner_user_id))
        .all(db)
        .await
        .map_err(|_| AppError::internal("failed to query folder ids"))?
        .into_iter()
        .map(|folder| folder.id)
        .collect::<Vec<_>>();

    for folder_id in folder_ids {
        repository::delete_wrapped_deks_for_resource(db, folder_id).await?;
    }

    entity::Entity::delete_many()
        .filter(entity::Column::UserId.eq(owner_user_id))
        .exec(db)
        .await
        .map_err(|_| AppError::internal("failed to delete folders"))?;

    Ok(())
}

fn map_folder(
    folder: entity::Model,
    dek: crate::domains::notes::dek_entity::Model,
) -> StoredFolder {
    StoredFolder {
        created_at: folder.created_at.to_rfc3339(),
        encrypted_dek: note_service::StoredWrappedDek {
            algorithm: dek.algorithm,
            kem_ciphertext_hex: dek.kem_ciphertext_hex,
            kek_public_key: dek.kek_public_key,
            nonce_hex: dek.nonce_hex,
            user_id: dek.user_id,
            version: dek.version,
            wrapped_dek_hex: dek.wrapped_dek_hex,
        },
        encrypted_payload: note_service::StoredEncryptedBlob {
            algorithm: folder.algorithm,
            ciphertext_hex: folder.ciphertext_hex,
            nonce_hex: folder.nonce_hex,
            version: folder.version,
        },
        id: folder.id,
        updated_at: folder.updated_at.to_rfc3339(),
    }
}
