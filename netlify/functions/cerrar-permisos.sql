-- ====================================================================
-- CERRAR PERMISOS ABIERTOS EN SUPABASE
-- Correr esto SOLO DESPUÉS de subir index.html + las 2 funciones nuevas
-- (admin-accion.js y accion-publica.js) a GitHub, y confirmar que el
-- deploy en Netlify terminó. Si lo corrés antes, se rompe el Panel.
-- ====================================================================

-- 1) PRESTADORES: solo lectura + alta pública (siempre sin verificar/Pro)
drop policy if exists p_all on prestadores;
create policy p_select on prestadores for select using (true);
create policy p_insert on prestadores for insert
  with check (verificado is not true and "proHasta" is null);

-- 2) VECINOS: solo lectura + alta pública (siempre sin aprobar/Destacado)
drop policy if exists v_all on vecinos;
create policy v_select on vecinos for select using (true);
create policy v_insert on vecinos for insert
  with check (aprobado is not true and destacado_hasta is null);

-- 3) RESEÑAS: lectura + alta pública (reportar ya no escribe directo, va por función)
drop policy if exists r_all on resenas;
create policy r_select on resenas for select using (true);
create policy r_insert on resenas for insert with check (true);

-- 4) PEDIDOS: ya no hay lectura pública (datos personales) ni alta directa
--    (todo pasa por las funciones protegidas ahora)
drop policy if exists pe_all on pedidos;
-- Sin políticas para "public" en pedidos = acceso cero con la clave anon.
-- El acceso real lo hacen las funciones de Netlify con la clave service_role,
-- que siempre puede saltarse RLS.

-- 5) CONFIG_APP: lectura pública sí (la app la necesita para sincronizar
--    barrios/nombre en todos los dispositivos), escritura ya no pública
drop policy if exists "config_app select..." on config_app;
drop policy if exists "config_app up..." on config_app;
create policy config_app_select on config_app for select using (true);

-- 6) CONFIG_ADMIN: confirmar que sigue sin ninguna política pública
--    (ya lo cerramos antes, esto es solo para verificar)
drop policy if exists ca_read on config_admin;
drop policy if exists "actualizar clave..." on config_admin;
