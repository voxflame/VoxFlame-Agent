-- Run after 20260907010000 in an isolated test database. Always rolls back fixtures.
BEGIN;
DO $$
BEGIN
  ASSERT public.valid_dialect_profiles('[{"name":"四川话","region":"四川成都"},{"name":"粤语","region":"广东广州"}]');
  ASSERT public.valid_dialect_profiles('[{"name":"四川话","region":""}]');
  ASSERT public.valid_dialect_profiles('[]');
  ASSERT NOT public.valid_dialect_profiles('null');
  ASSERT NOT public.valid_dialect_profiles('{}');
  ASSERT NOT public.valid_dialect_profiles('[{"name":"四川话"}]');
  ASSERT NOT public.valid_dialect_profiles('[{"name":"四川话、粤语","region":""}]');
  ASSERT NOT public.valid_dialect_profiles('[{"name":"四川话","region":5}]');
  ASSERT NOT public.valid_dialect_profiles('[{"name":"四川话","region":"","address":"private"}]');
  ASSERT NOT public.valid_dialect_profiles('[{"name":"四川话","region":""},{"name":" 四川话 ","region":""}]');
END;
$$;
ROLLBACK;
