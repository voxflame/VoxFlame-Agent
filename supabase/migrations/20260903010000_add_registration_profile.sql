-- Store one-time registration details in the backend-owned user profile.
-- Existing values always win; backfill only fills currently empty fields.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS disability_category TEXT,
  ADD COLUMN IF NOT EXISTS etiology TEXT,
  ADD COLUMN IF NOT EXISTS has_dialect BOOLEAN,
  ADD COLUMN IF NOT EXISTS dialect_name TEXT,
  ADD COLUMN IF NOT EXISTS identity_document_type TEXT,
  ADD COLUMN IF NOT EXISTS identity_document_number TEXT;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_identity_document_type_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_identity_document_type_check
  CHECK (
    identity_document_type IS NULL
    OR identity_document_type IN ('disability_certificate', 'id_card')
  );

COMMENT ON COLUMN public.user_profiles.contact_phone IS '注册时登记的联系电话；backend owner，不进入训练样本';
COMMENT ON COLUMN public.user_profiles.province IS '注册时登记的省份';
COMMENT ON COLUMN public.user_profiles.city IS '注册时登记的城市';
COMMENT ON COLUMN public.user_profiles.disability_category IS '注册时登记的残疾类别，可进入训练样本标签';
COMMENT ON COLUMN public.user_profiles.etiology IS '注册时登记的病种代码，可进入用户画像和训练样本标签';
COMMENT ON COLUMN public.user_profiles.has_dialect IS '用户是否登记使用方言；NULL 表示跳过未填写';
COMMENT ON COLUMN public.user_profiles.dialect_name IS '用户自述方言名称，可进入方言训练样本标签';
COMMENT ON COLUMN public.user_profiles.identity_document_type IS '高敏感身份资料类型；仅 backend owner 可访问';
COMMENT ON COLUMN public.user_profiles.identity_document_number IS '高敏感证件号；不得进入日志、前端响应或训练样本';

CREATE OR REPLACE FUNCTION public.sync_auth_registration_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::JSONB);
BEGIN
  INSERT INTO public.user_profiles (
    id,
    name,
    contact_phone,
    province,
    city,
    condition,
    disability_category,
    etiology,
    has_dialect,
    dialect_name,
    identity_document_type,
    identity_document_number
  ) VALUES (
    NEW.id,
    NULLIF(BTRIM(metadata ->> 'full_name'), ''),
    COALESCE(NULLIF(BTRIM(metadata ->> 'contact_phone'), ''), NULLIF(BTRIM(NEW.phone), '')),
    NULLIF(BTRIM(metadata ->> 'province'), ''),
    NULLIF(BTRIM(metadata ->> 'city'), ''),
    COALESCE(
      NULLIF(BTRIM(metadata ->> 'condition'), ''),
      NULLIF(BTRIM(metadata ->> 'disability_category'), '')
    ),
    NULLIF(BTRIM(metadata ->> 'disability_category'), ''),
    NULLIF(BTRIM(metadata ->> 'etiology'), ''),
    CASE
      WHEN metadata ? 'has_dialect' THEN (metadata ->> 'has_dialect')::BOOLEAN
      ELSE NULL
    END,
    NULLIF(BTRIM(metadata ->> 'dialect_name'), ''),
    NULLIF(BTRIM(metadata ->> 'identity_document_type'), ''),
    NULLIF(BTRIM(metadata ->> 'identity_document_number'), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(public.user_profiles.name, EXCLUDED.name),
    contact_phone = COALESCE(public.user_profiles.contact_phone, EXCLUDED.contact_phone),
    province = COALESCE(public.user_profiles.province, EXCLUDED.province),
    city = COALESCE(public.user_profiles.city, EXCLUDED.city),
    condition = COALESCE(public.user_profiles.condition, EXCLUDED.condition),
    disability_category = COALESCE(public.user_profiles.disability_category, EXCLUDED.disability_category),
    etiology = COALESCE(public.user_profiles.etiology, EXCLUDED.etiology),
    has_dialect = COALESCE(public.user_profiles.has_dialect, EXCLUDED.has_dialect),
    dialect_name = COALESCE(public.user_profiles.dialect_name, EXCLUDED.dialect_name),
    identity_document_type = COALESCE(public.user_profiles.identity_document_type, EXCLUDED.identity_document_type),
    identity_document_number = COALESCE(public.user_profiles.identity_document_number, EXCLUDED.identity_document_number),
    updated_at = CASE
      WHEN public.user_profiles.name IS NULL AND EXCLUDED.name IS NOT NULL
        OR public.user_profiles.contact_phone IS NULL AND EXCLUDED.contact_phone IS NOT NULL
        OR public.user_profiles.province IS NULL AND EXCLUDED.province IS NOT NULL
        OR public.user_profiles.city IS NULL AND EXCLUDED.city IS NOT NULL
        OR public.user_profiles.condition IS NULL AND EXCLUDED.condition IS NOT NULL
        OR public.user_profiles.disability_category IS NULL AND EXCLUDED.disability_category IS NOT NULL
        OR public.user_profiles.etiology IS NULL AND EXCLUDED.etiology IS NOT NULL
        OR public.user_profiles.has_dialect IS NULL AND EXCLUDED.has_dialect IS NOT NULL
        OR public.user_profiles.dialect_name IS NULL AND EXCLUDED.dialect_name IS NOT NULL
        OR public.user_profiles.identity_document_type IS NULL AND EXCLUDED.identity_document_type IS NOT NULL
        OR public.user_profiles.identity_document_number IS NULL AND EXCLUDED.identity_document_number IS NOT NULL
      THEN NOW()
      ELSE public.user_profiles.updated_at
    END;

  -- Keep both identity fields out of Auth metadata. The trigger has already
  -- copied them to the backend-owned profile before stripping them here.
  NEW.raw_user_meta_data := metadata - 'identity_document_type' - 'identity_document_number';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_auth_registration_profile_on_user_change ON auth.users;
DROP TRIGGER IF EXISTS capture_auth_registration_document_on_user_change ON auth.users;
CREATE TRIGGER capture_auth_registration_document_on_user_change
BEFORE INSERT OR UPDATE OF raw_user_meta_data ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_auth_registration_profile();

CREATE OR REPLACE FUNCTION public.sync_auth_registration_profile_after_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::JSONB);
BEGIN
  INSERT INTO public.user_profiles (
    id,
    name,
    contact_phone,
    province,
    city,
    condition,
    disability_category,
    etiology,
    has_dialect,
    dialect_name,
    identity_document_type
  ) VALUES (
    NEW.id,
    NULLIF(BTRIM(metadata ->> 'full_name'), ''),
    COALESCE(NULLIF(BTRIM(metadata ->> 'contact_phone'), ''), NULLIF(BTRIM(NEW.phone), '')),
    NULLIF(BTRIM(metadata ->> 'province'), ''),
    NULLIF(BTRIM(metadata ->> 'city'), ''),
    COALESCE(
      NULLIF(BTRIM(metadata ->> 'condition'), ''),
      NULLIF(BTRIM(metadata ->> 'disability_category'), '')
    ),
    NULLIF(BTRIM(metadata ->> 'disability_category'), ''),
    NULLIF(BTRIM(metadata ->> 'etiology'), ''),
    CASE
      WHEN metadata ? 'has_dialect' THEN (metadata ->> 'has_dialect')::BOOLEAN
      ELSE NULL
    END,
    NULLIF(BTRIM(metadata ->> 'dialect_name'), ''),
    NULLIF(BTRIM(metadata ->> 'identity_document_type'), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(public.user_profiles.name, EXCLUDED.name),
    contact_phone = COALESCE(public.user_profiles.contact_phone, EXCLUDED.contact_phone),
    province = COALESCE(public.user_profiles.province, EXCLUDED.province),
    city = COALESCE(public.user_profiles.city, EXCLUDED.city),
    condition = COALESCE(public.user_profiles.condition, EXCLUDED.condition),
    disability_category = COALESCE(public.user_profiles.disability_category, EXCLUDED.disability_category),
    etiology = COALESCE(public.user_profiles.etiology, EXCLUDED.etiology),
    has_dialect = COALESCE(public.user_profiles.has_dialect, EXCLUDED.has_dialect),
    dialect_name = COALESCE(public.user_profiles.dialect_name, EXCLUDED.dialect_name),
    identity_document_type = COALESCE(public.user_profiles.identity_document_type, EXCLUDED.identity_document_type);

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_auth_registration_profile_on_user_change
AFTER INSERT OR UPDATE OF raw_user_meta_data, phone ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_auth_registration_profile_after_change();

-- Conservative backfill: do not invent values and do not overwrite existing data.
INSERT INTO public.user_profiles (
  id,
  name,
  contact_phone,
  province,
  city,
  condition,
  disability_category,
  etiology,
  has_dialect,
  dialect_name,
  identity_document_type,
  identity_document_number
)
SELECT
  users.id,
  NULLIF(BTRIM(users.raw_user_meta_data ->> 'full_name'), ''),
  COALESCE(
    NULLIF(BTRIM(users.raw_user_meta_data ->> 'contact_phone'), ''),
    NULLIF(BTRIM(users.phone), '')
  ),
  NULLIF(BTRIM(users.raw_user_meta_data ->> 'province'), ''),
  NULLIF(BTRIM(users.raw_user_meta_data ->> 'city'), ''),
  COALESCE(
    NULLIF(BTRIM(users.raw_user_meta_data ->> 'condition'), ''),
    NULLIF(BTRIM(users.raw_user_meta_data ->> 'disability_category'), ''),
    NULLIF(BTRIM(profiles.preferences #>> '{user_profile_memory,etiology}'), '')
  ),
  NULLIF(BTRIM(users.raw_user_meta_data ->> 'disability_category'), ''),
  COALESCE(
    NULLIF(BTRIM(users.raw_user_meta_data ->> 'etiology'), ''),
    NULLIF(BTRIM(profiles.preferences #>> '{user_profile_memory,etiology}'), '')
  ),
  CASE
    WHEN users.raw_user_meta_data ? 'has_dialect' THEN (users.raw_user_meta_data ->> 'has_dialect')::BOOLEAN
    ELSE NULL
  END,
  NULLIF(BTRIM(users.raw_user_meta_data ->> 'dialect_name'), ''),
  NULLIF(BTRIM(users.raw_user_meta_data ->> 'identity_document_type'), ''),
  NULLIF(BTRIM(users.raw_user_meta_data ->> 'identity_document_number'), '')
FROM auth.users AS users
LEFT JOIN public.user_profiles AS profiles ON profiles.id = users.id
WHERE profiles.id IS NULL
  OR profiles.name IS NULL
  OR profiles.contact_phone IS NULL
  OR profiles.province IS NULL
  OR profiles.city IS NULL
  OR profiles.condition IS NULL
  OR profiles.disability_category IS NULL
  OR profiles.etiology IS NULL
  OR profiles.has_dialect IS NULL
  OR profiles.dialect_name IS NULL
  OR profiles.identity_document_type IS NULL
  OR profiles.identity_document_number IS NULL
ON CONFLICT (id) DO UPDATE SET
  name = COALESCE(public.user_profiles.name, EXCLUDED.name),
  contact_phone = COALESCE(public.user_profiles.contact_phone, EXCLUDED.contact_phone),
  province = COALESCE(public.user_profiles.province, EXCLUDED.province),
  city = COALESCE(public.user_profiles.city, EXCLUDED.city),
  condition = COALESCE(public.user_profiles.condition, EXCLUDED.condition),
  disability_category = COALESCE(public.user_profiles.disability_category, EXCLUDED.disability_category),
  etiology = COALESCE(public.user_profiles.etiology, EXCLUDED.etiology),
  has_dialect = COALESCE(public.user_profiles.has_dialect, EXCLUDED.has_dialect),
  dialect_name = COALESCE(public.user_profiles.dialect_name, EXCLUDED.dialect_name),
  identity_document_type = COALESCE(public.user_profiles.identity_document_type, EXCLUDED.identity_document_type),
  identity_document_number = COALESCE(public.user_profiles.identity_document_number, EXCLUDED.identity_document_number);
