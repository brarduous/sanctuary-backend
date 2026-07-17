-- Deterministic local-only fixtures. These IDs are reserved for automated tests.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
  email_change, email_change_token_new, created_at, updated_at
)
values
('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000001','authenticated','authenticated','lead-a@example.com',extensions.crypt('local-test-only',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}','','','','',now(),now()),
('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000002','authenticated','authenticated','care-a@example.com',extensions.crypt('local-test-only',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}','','','','',now(),now()),
('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000001','authenticated','authenticated','lead-b@example.com',extensions.crypt('local-test-only',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}','','','','',now(),now())
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
('11000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"sub":"10000000-0000-0000-0000-000000000001","email":"lead-a@example.com"}','email',now(),now(),now()),
('11000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','{"sub":"10000000-0000-0000-0000-000000000002","email":"care-a@example.com"}','email',now(),now(),now()),
('21000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','{"sub":"20000000-0000-0000-0000-000000000001","email":"lead-b@example.com"}','email',now(),now(),now())
on conflict (provider_id, provider) do nothing;

insert into public.congregations (congregation_id, name, leader_user_id)
values (900001, 'Harbor Example Church', '10000000-0000-0000-0000-000000000001'),
       (900002, 'Hillside Example Church', '20000000-0000-0000-0000-000000000001')
on conflict (congregation_id) do nothing;

insert into public.organization_memberships(congregation_id,user_id,role)
values (900001,'10000000-0000-0000-0000-000000000001','lead_pastor'),
       (900001,'10000000-0000-0000-0000-000000000002','care'),
       (900002,'20000000-0000-0000-0000-000000000001','lead_pastor')
on conflict do nothing;

insert into public.households(id, congregation_id, name, primary_phone) values
  ('91000000-0000-0000-0000-000000000001',900001,'Jordan Example Household','+15550101001'),
  ('92000000-0000-0000-0000-000000000001',900002,'Morgan Example Household','+15550102001') on conflict do nothing;
insert into public.church_crm_profiles(id,congregation_id,household_id,first_name,last_name,household_role,email,phone) values
  ('91100000-0000-0000-0000-000000000001',900001,'91000000-0000-0000-0000-000000000001','Alex','Jordan','adult','alex.jordan@example.com','+15550101001'),
  ('91100000-0000-0000-0000-000000000002',900001,'91000000-0000-0000-0000-000000000001','Riley','Jordan','child',null,null),
  ('92100000-0000-0000-0000-000000000001',900002,'92000000-0000-0000-0000-000000000001','Taylor','Morgan','adult','taylor.morgan@example.com','+15550102001') on conflict do nothing;
insert into public.guardian_relationships(congregation_id,guardian_profile_id,child_profile_id,relationship,verified_at)
values (900001,'91100000-0000-0000-0000-000000000001','91100000-0000-0000-0000-000000000002','parent',now()) on conflict do nothing;
insert into public.events(id,congregation_id,title,event_type,status,event_date) values
  ('91200000-0000-0000-0000-000000000001',900001,'Sunday Gathering','service','published',now()+interval '3 days'),
  ('92200000-0000-0000-0000-000000000001',900002,'Community Gathering','service','published',now()+interval '4 days') on conflict do nothing;
insert into public.volunteer_roles(id,congregation_id,name,join_policy) values
  ('91300000-0000-0000-0000-000000000001',900001,'Welcome Team','approval_required'), ('92300000-0000-0000-0000-000000000001',900002,'Hospitality Team','approval_required') on conflict do nothing;
insert into public.prayer_requests(congregation_id,user_id,request_text,visibility) values
  (900001,'10000000-0000-0000-0000-000000000001','Please pray for wisdom during a family transition.','pastor'),
  (900002,'20000000-0000-0000-0000-000000000001','Please pray for our neighborhood outreach.','pastor');
insert into public.pastoral_messages(congregation_id,title,message_body,is_published) values
  (900001,'Weekly update','A local-only example message.',false),
  (900002,'Community update','A local-only example message.',false);
