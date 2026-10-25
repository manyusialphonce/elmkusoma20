-- Preserve existing numeric IDs while aligning the entity primary key with BaseEntity UUID.
DO $$
DECLARE
    id_type TEXT;
BEGIN
    SELECT data_type INTO id_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'institution_services'
      AND column_name = 'id';

    IF id_type = 'bigint' THEN
        ALTER TABLE institution_services
            DROP CONSTRAINT institution_services_pkey;

        ALTER TABLE institution_services
            RENAME COLUMN id TO legacy_id;

        ALTER TABLE institution_services
            ADD COLUMN id UUID DEFAULT gen_random_uuid();

        ALTER TABLE institution_services
            ALTER COLUMN id SET NOT NULL;

        ALTER TABLE institution_services
            ADD CONSTRAINT institution_services_pkey PRIMARY KEY (id);

        ALTER TABLE institution_services
            ADD CONSTRAINT uq_institution_services_legacy_id UNIQUE (legacy_id);
    ELSIF id_type = 'uuid' THEN
        RAISE NOTICE 'institution_services.id is already UUID; no change needed.';
    ELSE
        RAISE EXCEPTION 'Unexpected institution_services.id type: %', id_type;
    END IF;
END $$;
