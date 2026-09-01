-- =====================================================================
--  ALMACÉN CPQ · LOS DOS ADMINISTRADORES
--
--  Se ejecuta DESPUÉS de que las dos personas se hayan registrado en la
--  página con su fotocheck. Ese orden no es un capricho:
--
--  La contraseña no vive en estas tablas. La guarda cifrada el servicio
--  de acceso de Supabase (auth.users), y solo se crea desde la página,
--  cuando la persona toca «Crear mi perfil» y la escribe ella. Ni este
--  script ni nadie con acceso a la base puede escribirla ni leerla —que
--  es justamente lo que se quiere—.
--
--  Lo que sí hace este script es lo otro: darles el puesto de admin y el
--  visto bueno, que sin él nacen esperando aprobación.
--
--     Joshua Amasifuén  ·  fotocheck 1352992
--     Luis              ·  fotocheck 1332751
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Ver quién se registró ya. Si alguno no aparece, todavía no ha
--     creado su perfil en la página: hágalo antes de seguir.
-- ---------------------------------------------------------------------
select fotocheck, nombre, puesto, aprobado, activo, creado_en
from perfiles
where fotocheck in ('1352992', '1332751')
order by fotocheck;

-- ---------------------------------------------------------------------
--  2. Dejarlos como administradores, aprobados y activos.
--     Se puede repetir sin daño: si ya lo estaban, no cambia nada.
-- ---------------------------------------------------------------------
update perfiles
   set puesto = 'admin', aprobado = true, activo = true
 where fotocheck in ('1352992', '1332751')
   and eliminado_en is null;

-- ---------------------------------------------------------------------
--  3. Comprobar que quedó hecho. Deben salir las dos filas con
--     puesto = admin y aprobado = true.
-- ---------------------------------------------------------------------
select fotocheck, nombre, puesto, aprobado, activo, version, actualizado_en
from perfiles
where fotocheck in ('1352992', '1332751')
order by fotocheck;


-- =====================================================================
--  SI ALGUNO OLVIDA SU CONTRASEÑA
--
--  No se puede consultar: está cifrada. Se le da una nueva desde el
--  panel de Supabase → Authentication → Users → el correo interno de esa
--  persona (1332751@columbito.local) → Reset password.
--
--  El correo es inventado por la página y no existe, así que el enlace
--  de recuperación no llega a ningún lado: hay que ponerle la clave
--  nueva a mano desde ese mismo panel y decírsela.
-- =====================================================================
