-- Retain delivery and completion history; switch back to calendar serving.
update public.discovery_runtime_settings set recycle_unplayed_sets=false;
