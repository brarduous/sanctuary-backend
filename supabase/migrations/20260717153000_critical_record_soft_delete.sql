begin;

do $$
declare table_name text;
begin
  foreach table_name in array array['church_crm_profiles','households','events','pastoral_messages','prayer_requests','check_ins'] loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists deleted_by uuid references auth.users(id)', table_name);
    execute format('alter table public.%I add column if not exists deletion_reason text', table_name);
    execute format('create index if not exists %I on public.%I(congregation_id, deleted_at)', 'idx_' || table_name || '_tenant_deleted', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_hide_deleted', table_name);
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (deleted_at is null)', table_name || '_hide_deleted', table_name);
  end loop;
end $$;

commit;
