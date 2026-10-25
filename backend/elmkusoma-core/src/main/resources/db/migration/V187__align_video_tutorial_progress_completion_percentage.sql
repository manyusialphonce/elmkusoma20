-- Align the persisted percentage type with the Java Double mapping.
-- Existing values are retained.
ALTER TABLE video_tutorial_progress
    ALTER COLUMN completion_percentage
    TYPE DOUBLE PRECISION
    USING completion_percentage::DOUBLE PRECISION;
