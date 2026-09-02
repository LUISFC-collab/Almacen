-- =====================================================================
--  ALMACÉN CPQ · SOLICITANTE POR CADA PUNTO DEL REQUISITO
--
--  El requisito llevaba un solo solicitante en la cabecera y el lugar
--  se escribía dos veces: arriba y en cada renglón. Ahora cada punto
--  lleva quién lo pide y dónde va; la cabecera conserva al que firma
--  el requisito y resume los frentes.
--
--  Ya ejecutado en obra-test-oregon. Se puede repetir sin daño.
-- =====================================================================

alter table requerimiento_items add column if not exists solicitante text;

comment on column requerimiento_items.solicitante is
  'Quién pide este punto en particular. Si va vacío, vale el solicitante de la
   cabecera del requisito.';
