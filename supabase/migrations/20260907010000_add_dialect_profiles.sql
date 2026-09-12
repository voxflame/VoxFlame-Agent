-- Additive only: registration background is distinct from per-recording labels.
-- Deploy this migration before new clients. No address-derived or legacy-name backfill.
BEGIN;

CREATE OR REPLACE FUNCTION public.valid_dialect_profiles(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  entry JSONB;
  seen JSONB := '[]'::JSONB;
BEGIN
  IF value IS NULL THEN RETURN FALSE; END IF;
  IF jsonb_typeof(value) <> 'array' THEN RETURN FALSE; END IF;
  IF jsonb_array_length(value) > 8 THEN RETURN FALSE; END IF;
  FOR entry IN SELECT * FROM jsonb_array_elements(value) LOOP
    IF jsonb_typeof(entry) <> 'object'
      OR jsonb_typeof(entry -> 'name') IS DISTINCT FROM 'string'
      OR jsonb_typeof(entry -> 'region') IS DISTINCT FROM 'string'
      OR (entry - 'name' - 'region') <> '{}'::JSONB THEN RETURN FALSE; END IF;
    IF char_length(btrim(entry ->> 'name')) NOT BETWEEN 1 AND 40
      OR char_length(btrim(entry ->> 'region')) > 80
      OR (entry ->> 'name') ~ '[、,，;；\n]'
      OR seen @> jsonb_build_array(jsonb_build_object('name', btrim(entry ->> 'name'), 'region', btrim(entry ->> 'region')))
      THEN RETURN FALSE; END IF;
    seen := seen || jsonb_build_array(jsonb_build_object('name', btrim(entry ->> 'name'), 'region', btrim(entry ->> 'region')));
  END LOOP;
  RETURN TRUE;
END;
$$;

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS dialect_profiles JSONB;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_dialect_profiles_check
  CHECK (dialect_profiles IS NULL OR public.valid_dialect_profiles(dialect_profiles));
COMMENT ON COLUMN public.user_profiles.dialect_profiles IS '用户自报常用方言列表 [{name,region}]；region 是方言来源，不是现居地；NULL=旧档案/未填，[]=明确无条目。不自动用于录音标签';
COMMENT ON COLUMN public.user_profiles.dialect_name IS '旧单方言客户端兼容字段；多方言不拼接写入。新客户端以 dialect_profiles 为准，待旧客户端与资料迁移完成后移除';
COMMENT ON COLUMN public.user_profiles.province IS '注册时登记地区；v2 起明确为现居省份，历史值不推断、不改写';
COMMENT ON COLUMN public.user_profiles.city IS '注册时登记地区；v2 起明确为现居城市，历史值不推断、不改写';

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
    dialect_profiles,
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
    CASE WHEN public.valid_dialect_profiles(metadata -> 'dialect_profiles')
      THEN metadata -> 'dialect_profiles' ELSE NULL END,
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
    dialect_profiles = COALESCE(public.user_profiles.dialect_profiles, EXCLUDED.dialect_profiles),
    identity_document_type = COALESCE(public.user_profiles.identity_document_type, EXCLUDED.identity_document_type);

  RETURN NEW;
END;
$$;

-- Recover explicitly submitted lists only; never infer them from residence.
UPDATE public.user_profiles AS profiles
SET dialect_profiles = users.raw_user_meta_data -> 'dialect_profiles'
FROM auth.users AS users
WHERE profiles.id = users.id
  AND profiles.dialect_profiles IS NULL
  AND public.valid_dialect_profiles(users.raw_user_meta_data -> 'dialect_profiles');

COMMIT;
