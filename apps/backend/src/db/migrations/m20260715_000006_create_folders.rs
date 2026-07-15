use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Folders::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Folders::Id).uuid().not_null().primary_key())
                    .col(ColumnDef::new(Folders::UserId).uuid().not_null())
                    .col(ColumnDef::new(Folders::Algorithm).string().not_null())
                    .col(ColumnDef::new(Folders::CiphertextHex).text().not_null())
                    .col(ColumnDef::new(Folders::NonceHex).string().not_null())
                    .col(ColumnDef::new(Folders::Version).integer().not_null())
                    .col(
                        ColumnDef::new(Folders::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(Folders::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-folders-user-id")
                            .from(Folders::Table, Folders::UserId)
                            .to(Users::Table, Users::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx-folders-user-id-updated-at")
                    .table(Folders::Table)
                    .col(Folders::UserId)
                    .col(Folders::UpdatedAt)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Folders::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Folders {
    Table,
    Id,
    UserId,
    Algorithm,
    CiphertextHex,
    NonceHex,
    Version,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Users {
    Table,
    Id,
}
