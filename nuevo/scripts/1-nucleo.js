/* =====================================================================
   ALMACÉN CPQ · NÚCLEO

   Los datos, el acceso por fotocheck, las unidades, la lectura y la
   escritura de Excel, y el puente entre consolidado e inventario.

   Los dos archivos comparten variables a propósito: por eso no van
   envueltos en una función. El orden importa — este primero.
   ===================================================================== */
"use strict";

var CLAVE = "almacen_simple_v1";
var $ = function(id){ return document.getElementById(id); };
var esc = function(t){ return String(t == null ? "" : t)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); };
var num = function(v){ var n = parseFloat(v); return isNaN(n) ? 0 : n; };
var hoy = function(){ var d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
var fecha = function(iso){ if(!iso) return "—";
  var d = new Date(iso); if(isNaN(d)) return String(iso).slice(0,10);
  return String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getFullYear()).slice(2); };
var uid = function(){ return "x" + (contador++) + "-" + Math.floor(performance.now()*1000); };
var contador = 1;

/* ============ datos ============ */
function semilla(){
  /* Los 608 renglones del consolidado de la obra, los mismos que
     carga 06_datos.sql en la base. Aquí van para que la página sirva
     desde el primer día, sin esperar a que esté montado Supabase. */
  var cons = [
    ["R01-001","Contenedores de 20 pies","und",3],
    ["R01-002","Radio de comunicación con señal interna de MY","und",1],
    ["R01-003","Escritorios","und",5],
    ["R01-004","Sillas para escritorios","und",5],
    ["R01-005","Martillo para demolición, marca HILTI","und",1],
    ["R01-006","Parihuela de madera","und",4],
    ["R01-007","Cilindro negro con tapa de geomembrana","und",1],
    ["R01-008","Cilindro Amarillo con tapa de geomembrana","und",1],
    ["R01-009","Cilindro Rojo con tapa de geomembrana","und",1],
    ["R01-010","Cilindro Blanco con tapa de geomembrana","und",1],
    ["R01-011","Cilindro Azul con tapa de geomembrana","und",1],
    ["R01-012","Cilindro de Kit anti derrame con tapa de geomembrana","und",1],
    ["R01-013","Letrero \"Zona de desechos\", con poste de 2.20m","und",1],
    ["R01-014","Bidon de agua para beber","und",1],
    ["R01-015","Botiquin completo de acuerdo al estandar MY, coordinar con EHS","und",1],
    ["R01-016","Conos  de seguridad de 1.20m","und",20],
    ["R01-017","CADENA amarilla de 1/2\"","m",200],
    ["R01-018","CADENA roja de 1/2\"","m",200],
    ["R01-019","Extintor de 6 Kg","und",2],
    ["R01-020","Impresora multifuncional","und",1],
    ["R01-021","Generador electrico, 3000 W a más","und",1],
    ["R01-022","Caseta con  bandeja de 2x2x2m, con  malla galvanizada","und",1],
    ["R01-023","Enchufes tipo menekes de 16 amperios","und",4],
    ["R01-024","Servicio higiénico portatil","und",2],
    ["R01-025","Lavadero de manos portatil","und",1],
    ["R01-026","Lava ojos","und",1],
    ["R01-027","Porta lava ojos","und",1],
    ["R01-028","Archivadores de 2 huecos","und",4],
    ["R01-029","Papel Bond","mll",4],
    ["R01-030","Perforador de 2 huecos","und",1],
    ["R01-031","Engrapador","und",1],
    ["R01-032","Grapas","cja",2],
    ["R01-033","Tampon","und",1],
    ["R01-034","Lapiceros: Azul, negro, rojo","und",12],
    ["R01-035","Plumones: Azul, negro, rojo y verde","und",12],
    ["R01-036","Resaltadores","und",3],
    ["R01-037","Corrector","und",3],
    ["R01-038","Tablero para papel A4","und",3],
    ["R01-039","Comba de 4 libras antichispa","und",3],
    ["R01-040","Cincel de punta de fábrica","und",2],
    ["R01-041","Esmeril angular de 7\"","und",2],
    ["R01-042","Disco de corte para concreto de 7\"","und",1],
    ["R01-043","Disco de corte parea metal de 7\"","und",10],
    ["R01-044","Tablero electrico portatil de 220V Con 4 salidas","und",2],
    ["R01-045","Extensiones eléctricas de 220 monofásicas con cable a tierra y toma industrial macho y hembra","und",6],
    ["R01-046","Buggie CARRETILLAS","und",4],
    ["R01-047","Palana cuchara","und",4],
    ["R01-048","Taladro eléctrico","und",1],
    ["R01-049","Taladro inalambrico con bateria de 18v a mas","und",2],
    ["R01-050","Atornillador inalambrico","und",1],
    ["R01-051","Revelador de tensión","und",1],
    ["R01-052","Pinza amperimétrica","und",1],
    ["R01-053","Escalera con plataforma de 0.5m de altura","und",1],
    ["R01-054","Escalera con plataforma de 1.6m de altura","und",1],
    ["R01-055","Pizarra de Pre inicio (formato nuevo)|","und",2],
    ["R01-056","Porta pizarras","und",2],
    ["R01-057","Galoneras para combustible metálicas","und",4],
    ["R01-058","Terminales tipo ojo 2/0","und",4],
    ["R01-059","Estación total LEICA, inc. Prisma y Miniprisma","und",1],
    ["R01-060","Conectores rectos de 3/4\"","und",90],
    ["R01-061","Tuerca Bushing con aterramiento","und",20],
    ["R01-062","Reducción elarrier de 1/2\" a 3/4\"","und",40],
    ["R01-063","Terminal estarfil para cable de 16 AWG","und",150],
    ["R01-064","Terminal estarfil para cable de 14 AWG","und",200],
    ["R01-065","Conectores rectos de 3/4\"","und",25],
    ["R01-066","Conectores rectos de 1 1/2\"","und",6],
    ["R01-067","Tuerca Bushing con aterramiento de 3/4\"","und",30],
    ["R01-068","Tuerca Bushing con aterramiento de 1 1/2\"","und",8],
    ["R01-069","Galvanox","und",5],
    ["R01-070","Fire stop","kg",4],
    ["R01-071","Terminal starfil para cable de 14 AWG","und",300],
    ["R01-072","Terminal tipo uña para cable de 14 AWG","und",100],
    ["R01-073","Terminal tipo ojo para cable de 12 AWG","und",200],
    ["R01-074","Terminal tipo ojo para cable de 4 AWG","und",20],
    ["R01-075","Cinta Aislante super 33","und",4],
    ["R01-076","Cinta Bulcanizante","und",1],
    ["R01-077","Cinta Aislante 3M","und",4],
    ["R01-078","Pernos estuboles con tuerca garandela de 3/16\" x 2.5\"","und",30],
    ["R01-079","Tuerca de resorte de 3/8\"","und",35],
    ["R01-080","Pernos Galvanizados con tuerca y arandela de 3/8\" x 1\"","und",35],
    ["R01-081","Borneras industriales para cable 12AWG","und",20],
    ["R01-082","Borneras industriales de tierra para cable 12AWG","und",8],
    ["R01-083","Borneras industriales para cable 4AWG","und",8],
    ["R01-084","Borneras industriales de tierra para cable 4AWG","und",2],
    ["R01-085","Tuerca de resorte de 1/2\"","und",15],
    ["R01-086","Perno galvanizado de 1/2\" x 1\"","und",15],
    ["R01-087","Cintillos negros de 150 mm","und",300],
    ["R01-088","Cintillo blancos de 150 mm","und",300],
    ["R01-089","Cintillos blancos de 100 mm","und",200],
    ["R01-090","Caja tablero metálico IP67 50 × 60 × 20 cm, NEMA 4","und",2],
    ["R01-091","ITM K 25A monofásico","und",2],
    ["R01-092","ITM C 16A monofásico","und",8],
    ["R01-093","Interruptor diferencial 25A, Ic = 30 mA, 220 V AC","und",8],
    ["R01-094","Terminal tipo pin sobremoldeado 12 AWG, color azul","und",100],
    ["R01-095","Terminal tipo ojo 12 AWG","und",20],
    ["R01-096","Canaleta PVC ranurada 40 × 40 mm","m",6],
    ["R01-097","Riel DIN","m",2],
    ["R01-098","Tornillo Wafer 8 × 1/2\"","und",40],
    ["R01-099","Espárrago 3/8\" zincado","m",3.6],
    ["R01-100","Tuerca hexagonal flange 3/8\" zincado","und",36],
    ["R01-101","Mica transparente 50 × 32 cm, espesor 4 mm","und",2],
    ["R01-102","Puente de conexión tipo peine monofásico 10 mm² × 6 polos","und",2],
    ["R01-103","Tomacorriente industrial monofásico hembra 16A IP67 para empotrado","und",8],
    ["R01-104","Perno 3/16\" × 1\" zincado con doble arandela, tuerca y arandela de presión","und",36],
    ["R01-105","Prensaestopa PG 13.5 PVC","und",4],
    ["R01-106","Cable unipolar color amarillo/verde 6 mm² THW","m",8],
    ["R01-107","Cable 3 × 10 AWG vulcanizado","m",30],
    ["R01-108","Terminal 8 mm² tipo ojo","und",4],
    ["R01-109","Tomacorriente industrial 32A monofásico IP67 macho","und",2],
    ["R01-110","Sticker autoadhesivo \"Riesgo Eléctrico\" estándar 220 V","und",2],
    ["R01-111","PIPE STD WT ERW CS A53-B TYPE E 3,4 m de 2\"","und",2],
    ["R01-112","ELL 90 DEG 3000# SW STL A105 2\"","und",8],
    ["R01-113","TEE RED 3000# SW STL A105 2\" × ½\"","und",2],
    ["R01-114","FLG SW CLASS 150 RF CS STD BORE A105 2\"","und",2],
    ["R01-115","NIPPLE XS STL A106-B TOE 3\" LONG ½\"","und",4],
    ["R01-116","BALL 300# SCRD STL CS/SS, HNDL OP 2\"","und",2],
    ["R01-117","BALL 300# SCRD STL CS/SS, HNDL OP ½\"","und",2],
    ["R01-118","Sello para supervisor QC","und",1],
    ["R01-119","Camilla (FEL)","und",1],
    ["R01-120","Correas para camilla","jgo",1],
    ["R01-121","Maletín de abordaje","und",1],
    ["R01-122","Férula rígida","jgo",1],
    ["R01-123","Férulas maleables","und",1],
    ["R01-124","Gasas","und",10],
    ["R01-125","Apósitos","und",10],
    ["R01-126","Vendas elásticas 4\"","und",5],
    ["R01-127","Vendas elásticas 2\"","und",5],
    ["R01-128","Esparadrapo 2.5 cm × 5 m","und",1],
    ["R01-129","Algodón 50 gr","und",1],
    ["R01-130","Guantes de látex","par",5],
    ["R01-131","Alcohol al 70% de 120 ml","und",1],
    ["R01-132","Mantas térmicas","und",2],
    ["R01-133","Diclofenaco al 2%","und",1],
    ["R01-134","Tijera de trauma","und",1],
    ["R01-135","Botella de agua de 500 ml","und",1],
    ["R01-136","Bolsas rojas","und",6],
    ["R01-137","Kit Water Gel (quemaduras)","und",1],
    ["R01-138","Frazada","und",1],
    ["R01-139","Agua oxigenada al 3%","und",1],
    ["R01-140","Balón de oxígeno 1/4 m – 1.7 kg","und",1],
    ["R01-141","Trípode","und",1],
    ["R01-142","Taladro inalámbrico","und",2],
    ["R01-143","Multitester","und",1],
    ["R01-144","Copa de sierra","jgo",1],
    ["R01-145","Escalera plataforma","und",1],
    ["R01-146","Prensa terminal hidráulica","und",1],
    ["R01-147","Candados de bloqueo","und",5],
    ["R01-148","Caja de bloqueo","und",1],
    ["R01-149","Revelador de tensión alta y baja","und",1],
    ["R01-150","Ropa antiarco","jgo",2],
    ["R01-151","Careta antiarco","und",2],
    ["R01-152","Bala clava","und",2],
    ["R01-153","Guantes antiarco clase 0","jgo",2],
    ["R01-154","Sobreguantes","jgo",2],
    ["R01-155","Cinta aislante 3M","und",4],
    ["R01-156","Cinta maskintape de 2\"","und",1],
    ["R01-157","Maletín de herramientas","und",3],
    ["R01-158","Candados para maletín de herramientas","und",3],
    ["R01-159","Martillo","und",3],
    ["R01-160","Escuadra 12\"","und",3],
    ["R01-161","Flexómetro de 5 m","und",3],
    ["R01-162","Juego de destornilladores","jgo",3],
    ["R01-163","Juego de llaves mixtas","jgo",3],
    ["R01-164","Juego de llaves Alen","jgo",3],
    ["R01-165","Juego de llaves Tor","jgo",3],
    ["R01-166","Nivel torpedo","und",3],
    ["R01-167","Llave Stilson de 12\"","und",3],
    ["R01-168","Llave francesa","und",3],
    ["R01-169","Lima redonda","und",3],
    ["R01-170","Lima media caña","und",3],
    ["R01-171","Lima plana","und",3],
    ["R01-172","Pelacable","und",3],
    ["R01-173","Prensa terminal mixta (estampel y pin)","und",3],
    ["R01-174","Cuchilla de electricista","und",3],
    ["R01-175","Arco de sierra","und",3],
    ["R01-176","Juego de dados","jgo",3],
    ["R01-177","½\" PIPE STD WT ERW CS A53-B TYPE E","m",6],
    ["R01-178","1\" PIPE STD WT ERW CS A53-B TYPE E","m",54],
    ["R01-179","1½\" PIPE STD WT ERW CS A53-B TYPE E","m",42],
    ["R01-180","2\" PIPE STD WT ERW CS A53-B TYPE E","m",552],
    ["R01-181","1\" CHECK 800# SW STL SWING","und",5],
    ["R01-182","1½\" CHECK 800# SW STL SWING","und",5],
    ["R01-183","2\" CHECK 800# SW STL SWING","und",1],
    ["R01-184","½\" BALL 300# SCRD STL CS/SS, HNDL OP","und",24],
    ["R01-185","1\" BALL 300# SCRD STL CS/SS, HNDL OP","und",22],
    ["R01-186","1½\" BALL 300# SCRD STL CS/SS, HNDL OP","und",17],
    ["R01-187","2\" BALL 300# SCRD STL CS/SS, HNDL OP","und",18],
    ["R01-188","½\" FLG SW CLASS 150 RF CS STD BORE A105","und",2],
    ["R01-189","1\" FLG SW CLASS 150 RF CS STD BORE A105","und",5],
    ["R01-190","1½\" FLG SW CLASS 150 RF CS STD BORE A105","und",12],
    ["R01-191","2\" FLG SW CLASS 150 RF CS STD BORE A105","und",7],
    ["R01-192","½\" GASKET 150# NOM-ASB-RING PT AGT 1/8\" THK","und",6],
    ["R01-193","1\" GASKET 150# NOM-ASB-RING PT AGT 1/8\" THK","und",5],
    ["R01-194","1½\" GASKET 150# NOM-ASB-RING PT AGT 1/8\" THK","und",11],
    ["R01-195","2\" GASKET 150# NOM-ASB-RING PT AGT 1/8\" THK","und",7],
    ["R01-196","3\" GASKET 150# NOM-ASB-RING PT AGT 1/8\" THK","und",28],
    ["R01-197","4\" GASKET 150# NOM-ASB-RING PT AGT 1/8\" THK","und",8],
    ["R01-198","3\" a 1\" SOCKOLET 3000# STL A105","und",7],
    ["R01-199","3\" a 1½\" SOCKOLET 3000# STL A105","und",5],
    ["R01-200","3\" a 2\" SOCKOLET 3000# STL A105","und",3],
    ["R01-201","½\" ELL 90 DEG 3000# SW STL A105","und",4],
    ["R01-202","1\" ELL 45 DEG STD WT STL A234 WPB","und",1],
    ["R01-203","1\" ELL 90 DEG 3000# SW STL A105","und",38],
    ["R01-204","1½\" ELL 90 DEG 3000# SW STL A105","und",27],
    ["R01-205","2\" ELL 90 DEG 3000# SW STL A105","und",64],
    ["R01-206","½\" TEE 3000# SW STL A105","und",4],
    ["R01-207","1\" TEE 3000# SW STL A105","und",16],
    ["R01-208","1½\" TEE 3000# SW STL A105","und",10],
    ["R01-209","2\" TEE 3000# SW STL A105","und",9],
    ["R01-210","2\" x ½\" TEE RED 3000# SW STL A105","und",2],
    ["R01-211","1½\" x 1\" TEE RED 3000# SW STL A105","und",1],
    ["R01-212","1½\" x ½\" TEE RED 3000# SW STL A105","und",8],
    ["R01-213","1\" x ½\" TEE RED 3000# SW STL A105","und",6],
    ["R01-214","1\" x ½\" SWAGE CONC XS STL A234 WPB PBE","und",4],
    ["R01-215","3\" x 2\" SWAGE CONC XS STL A234 WPB PBE","und",1],
    ["R01-216","1½\" x 1\" SWAGE CONC XS STL A234 WPB PBE","und",6],
    ["R01-217","2\" x 1½\" SWAGE CONC XS STL A234 WPB PBE","und",4],
    ["R01-218","½\" NIPPLE XS STL A106-B TOE 3\" LONG","und",25],
    ["R01-219","1\" NIPPLE XS STL A106-B TOE 3\" LONG","und",12],
    ["R01-220","1½\" NIPPLE XS STL A106-B TOE 3\" LONG","und",10],
    ["R01-221","2\" NIPPLE XS STL A106-B TOE 3\" LONG","und",4],
    ["R01-222","1\" CAP SCREW HEX HEAD CR-MO A193 GR B7 UNC","und",1],
    ["R01-223","1\" PRESSURE RELIEF VALVE... SET POINT 42 PSIg","und",1],
    ["R01-224","1\" PRESSURE RELIEF VALVE... SET POINT 55 PSIg","und",1],
    ["R01-225","1\" PRESSURE RELIEF VALVE... SET POINT 57 PSIg","und",1],
    ["R01-226","1\" VÁLVULA DE SEGURIDAD... SET POINT 50 PSIg","und",1],
    ["R01-227","3\" x 2\" REDUCER ECC STD WT STL A234 WPB","und",3],
    ["R01-228","5/8\" x 4 1/4\" STUD-BOLT A193 GR B7 W/A 194 GR 2H NUTS","und",16],
    ["R01-229","5/8\" x 4 3/4\" STUD-BOLT A193 GR B7 W/A 194 GR 2H NUTS","und",24],
    ["R01-230","5/8\" x 6 5/8\" STUD-BOLT A193 GR B7 W/A 194 GR 2H NUTS","und",52],
    ["R01-231","5/8\" x 5 3/4\" STUD-BOLT A193 GR B7 W/A 194 GR 2H NUTS","und",16],
    ["R01-232","5/8\" x 6 3/4\" STUD-BOLT A193 GR B7 W/A 194 GR 2H NUTS","und",24],
    ["R01-233","Cintas topograficas color rojo","und",1],
    ["R01-234","Cintas topograficas color blanco","und",1],
    ["R01-235","Cintas topograficas color amarillo","und",1],
    ["R01-236","Cintas topograficas color azul","und",1],
    ["R01-237","Wincha de 5 mt","und",1],
    ["R01-238","Libreta de apuntes","und",1],
    ["R01-239","Cintas de inspección aislante azul","und",6],
    ["R01-240","Rotulados de nombres para cascos","und",24],
    ["R01-241","Candados medianos","und",2],
    ["R01-242","Impresión total de IPERC base para container","und",1],
    ["R01-243","Impresión total de la gestión de riesgos","und",1],
    ["R01-244","Letrero de disposición de residuos","und",1],
    ["R01-245","Letrero zona segura para hablar por celular","und",2],
    ["R01-246","Letreros zonas de exclusión \"Prohibido ingreso\"","und",1],
    ["R01-247","Banner de mapa de riesgos","und",1],
    ["R01-248","Banner de mapa de zonas de tormentas eléctricas","und",1],
    ["R01-249","RIT al personal","und",1],
    ["R01-250","PETS de labores impresos","jgo",3],
    ["R01-251","Estación de emergencia","und",1],
    ["R01-252","Riesgos de fatalidad enmicados tamaño A4","jgo",4],
    ["R01-253","Archivadores de 2 hoyos","und",10],
    ["R01-254","Plumón indeleble punta fina","und",6],
    ["R01-255","Correctores","und",6],
    ["R01-256","Cartillas de seguridad enmicadas para todo el personal (respuesta a emergencia, riesgos de fatalidad, tarjeta roja, tarjeta verde, disposición de residuos, tormentas eléctricas, uso de EPP para productos químicos)","jgo",35],
    ["R01-257","Cintas de inspección trimestral","und",6],
    ["R01-258","Winchas de 8m","und",6],
    ["R01-259","Plumones de tinta indeleble punta normal","und",6],
    ["R01-260","Micas para planos A3","und",50],
    ["R01-261","Micas A4","und",25],
    ["R01-262","Tijera de oficina","und",1],
    ["R01-263","Trapo industrial","kg",5],
    ["R01-264","Escobas","und",1],
    ["R01-265","Recogedor de basura","und",1],
    ["R01-266","Botes de basura para oficina","und",3],
    ["R01-267","Hervidor de agua","und",1],
    ["R01-268","Microondas","und",1],
    ["R01-269","ESPÁRRAGOS DE 5/8” X 400mm","und",15],
    ["R01-270","ARANDELAS DE 5/8\"","und",16],
    ["R01-271","TUERCAS DE 5/8”","und",30],
    ["R01-272","ESPÁRRAGOS DE 1/2” X 180mm","und",28],
    ["R01-273","ARANDELAS DE 1/2”","und",30],
    ["R01-274","TUERCAS DE 1/2”","und",56],
    ["R01-275","Radio de comunicación con señal interna de MY","und",1],
    ["R01-276","Wakie talkies motorola","und",5],
    ["R01-277","Cable desnudo de cobre de 2/0","m",50],
    ["R01-278","Terminal de ojo para cable 2/0 con agujero de 3/8","und",6],
    ["R01-279","Terminal de cobre partido para cable 2/0","und",6],
    ["R01-280","Conector AB para pozo a tierra de 5/8","und",4],
    ["R01-281","Cinta verde 3M","und",2],
    ["R01-282","Perno galvanizado de 3/8 x 1 1/2\" con tuerca y arandela","und",6],
    ["R01-283","Ganchos tipo \"S\" de fierro corrugado con revestimiento de manguera para cables","und",10],
    ["R01-284","Cintillos de 200 mm","paq",1],
    ["R01-285","Driza de 1/4","m",20],
    ["R01-286","Letreros de riesgo eléctrico con micas en A4","und",10],
    ["R01-287","Letreros de zona de exclusión: con acceso y sin acceso (de cada uno)","jgo",4],
    ["R01-288","Rapimix de 210 kg/cm2 tipo MS","bls",100],
    ["R01-289","Juego de alicates","jgo",3],
    ["R01-290","Escalera plataforma de 4 pasos","und",1],
    ["R01-291","Candados para almacén de 40 mm","und",2],
    ["R01-292","Puntero punta estrella","und",2],
    ["R01-293","Base magnética 5/16 × 3","und",3],
    ["R01-294","Pernos Wafer punta broca de 3/16 × 1/2","und",10],
    ["R01-295","Autoperforantes punta broca de 5/16 × 1","und",20],
    ["R01-296","Zapapico","und",2],
    ["R01-297","Rastrillo","und",2],
    ["R01-298","Barreta","und",1],
    ["R01-299","Logotipos adhesivos de la empresa para contenedores de 1.20 × 0.60 m","und",4],
    ["R01-300","Sillas de oficina","und",4],
    ["R01-301","Traje de cuero cromado completo XL","und",3],
    ["R01-302","Respirador media cara","und",3],
    ["R01-303","Filtros 2097","par",6],
    ["R01-304","Careta fácial","und",6],
    ["R01-305","Guantes caña larga","par",3],
    ["R01-306","de Rodilleras","par",6],
    ["R01-307","Maquina de soldar 220","und",2],
    ["R01-308","Amoladoras 4 1/2\"","und",3],
    ["R01-309","amoladora de 7\"","und",2],
    ["R01-310","Nivel torpedo","und",2],
    ["R01-311","Escuadra de 12\"","und",2],
    ["R01-312","escuadra de 24\"","und",2],
    ["R01-313","Martillo de bola","und",2],
    ["R01-314","Destornilladores planos de golpe de 24\"","und",4],
    ["R01-315","Lima media caña","und",2],
    ["R01-316","Llave francesa de 12","und",2],
    ["R01-317","Flexometro de 30m","und",1],
    ["R01-318","Eslingas de 2x2","und",4],
    ["R01-319","Tecle ratche de 2tn","und",1],
    ["R01-320","Caja de herramientas","und",2],
    ["R01-321","Grilletes 3/4","und",2],
    ["R01-322","Extensiones 220 x 50 m","und",6],
    ["R01-323","Fleje de 2\" x 1m","und",2],
    ["R01-324","Alicate de presión","und",1],
    ["R01-325","atornillador plano mecánico","und",2],
    ["R01-326","atornillador estrella","und",2],
    ["R01-327","Llave estilzon 12\"","und",2],
    ["R01-328","Juego de llaves mixtas","und",1],
    ["R01-329","Prensa trípode con cadena","und",1],
    ["R01-330","trípode para tubería","und",4],
    ["R01-331","mantas inifuga","und",6],
    ["R01-332","carpa inifuga con sus estructuras","und",1],
    ["R01-333","abrazadera para armar tuberia de 3\"","und",1],
    ["R01-334","abrazadera para armar tuberia de 2\"","und",1],
    ["R01-335","arnés de cuerpo entero","und",8],
    ["R01-336","líneas de metal con absorbedor de impacto Para soldador","und",2],
    ["R01-337","líneas con adsobedor de impacto","und",4],
    ["R01-338","tambor rectactil","und",2],
    ["R01-339","Pizarras blancas de 1.20m","und",2],
    ["R01-340","EPP completo","und",6],
    ["R01-341","Imprimír el manual de salud y seguridad","und",1],
    ["R01-342","Cortinas con rieles de  1.10 m","und",2],
    ["R01-343","Bidones de agua","und",10],
    ["R01-344","Tintas de impresora C664,M664,Y664, Bk664","und",4],
    ["R01-345","Cajas de clips","und",4],
    ["R01-346","Post its","paq",1],
    ["R01-347","Cinta de embalaje","und",6],
    ["R01-348","Chinches","cja",1],
    ["R01-349","Porta clips","und",1],
    ["R01-350","Mircas A4","paq",6],
    ["R01-351","Perforador de dos huecos","und",1],
    ["R01-352","Tijera de oficina","und",1],
    ["R01-353","Engrapador","und",1],
    ["R01-354","Lapiceros azul,negro, rojo","und",18],
    ["R01-355","Limpia todo de vainilla","und",1],
    ["R01-356","Cinta scotch","und",6],
    ["R01-357","Stickers de riesgo electrico HMS","und",50],
    ["R01-358","Alcohol de 70°","und",3],
    ["R01-359","PORTAEXTINTOR","und",2],
    ["R01-360","UNIFORME ANTIARCO","und",2],
    ["R01-361","PERTIGA","und",1],
    ["R01-362","REVELADOR","und",1],
    ["R01-363","MEGHÓMETRO","und",1],
    ["R01-364","TIERRA TEMPORARIA","und",1],
    ["R01-365","TELURÓMETRO","und",1],
    ["R01-366","CARTILLAS DE INSPECCIÓN DE EXTINTORES","und",20],
    ["R01-367","CARTILLAS DE INSPECCIÓN DE BOTIQUIN","und",20],
    ["R01-368","PORTADOCUMENTOS PARA HOJAS HSMDS","und",1],
    ["R01-369","ARCHIVADORES A3","und",3],
    ["R01-370","PLANOS EN A3 DE TODO EL PROYECTO","jgo",1],
    ["R01-371","HERRAMIENTAS DIELÉCTRICAS (LLAVES,ETC)","jgo",1],
    ["R01-372","CINTILLOS DE COLORES","paq",2],
    ["R01-373","PRENSA HIDRÁULICA","und",1],
    ["R01-374","VASOS DESCARTABLES","paq",2],
    ["R01-375","ESCALERA DE 2 PASOS","und",2],
    ["R01-376","ESCALERA","und",1],
    ["R01-377","TUBO CONDUIT 1 1/2","und",144],
    ["R01-378","ABRAZADERAS PARA CANAL UNISTRUT 1 1/2","und",200],
    ["R01-379","CANAL UNISTRUT","und",6],
    ["R01-380","CAJA CONDULET TIPO C 1 1/2","und",9],
    ["R01-381","CAJA CONDULET TIPO LB 1 1/2","und",12],
    ["R01-382","TUERCA BUSHING CON ATERRAMIENTO 1 1/2","und",6],
    ["R01-383","CONECTORES DOMÉSTICOS MACHOS LEBINTON","und",2],
    ["R01-384","BROCAS DE COBALTO 1/4","und",4],
    ["R01-385","BROCAS DE COBALTO 3/8","und",4],
    ["R01-386","BROCAS DE COBALTO 1/2","und",2],
    ["R01-387","HOJA DE SIERRA","und",10],
    ["R01-388","VARILLAS PARA ATERRAMIENTO DE TABLEROS 3/4 x 1m","und",2],
    ["R01-389","CONECTOR AB COBRE","und",3],
    ["R01-390","ALCOHOLÍMETRO","und",1],
    ["R01-391","GALVANOX","und",4],
    ["R01-392","ENMICADORA","und",1],
    ["R01-393","MICAS PARA ENMICAR","und",30],
    ["R01-394","SOBRES MANILA","paq",1],
    ["R01-395","TARRAJA MANUAL CON CABEZAL Y MANERAL CON TARRAJAS  de 3/4\" ; 1\" ; 1/2\" 2\"","jgo",1],
    ["R01-396","DOBLADORA PARA TUBERIA CONDUIT CON ESTAMPAS PARA  de 3/4\" ; 1\" ; 1/2\" 2\"","jgo",1],
    ["R01-397","JERSEYS","und",22],
    ["R01-398","Traje de cuero cromado completo","und",3],
    ["R01-399","Respirador media cara","und",3],
    ["R01-400","Filtros 2097","par",6],
    ["R01-401","Careta fácial","und",6],
    ["R01-402","Guantes caña larga","par",3],
    ["R01-403","Rodilleras","par",6],
    ["R01-404","Maquina de soldar 220","und",2],
    ["R01-405","Amoladoras 4 1/2\"","und",3],
    ["R01-406","Amoladora de 7\"","und",2],
    ["R01-407","Nivel torpedo","und",2],
    ["R01-408","Escuadra de 12\"","und",2],
    ["R01-409","Escuadra de 24\"","und",2],
    ["R01-410","Martillo de bola","und",2],
    ["R01-411","Destornilladores planos  de golpe de 24 \"","und",4],
    ["R01-412","Lima media caña","und",2],
    ["R01-413","Llave francesa de 12","und",2],
    ["R01-414","Flexometro de 30m","und",1],
    ["R01-415","Eslingas de 2x2","und",4],
    ["R01-416","Tecle ratche de  2tn","und",1],
    ["R01-417","Caja de herramientas","und",2],
    ["R01-418","Grilletes 3/4","und",2],
    ["R01-419","Extensiones 220 x 50 m","und",6],
    ["R01-420","Fleje de 2\" x 1m","und",2],
    ["R01-421","Alicate de presión","und",1],
    ["R01-422","Atornillador plano mecánico","und",2],
    ["R01-423","Atornillador estrella","und",2],
    ["R01-424","Llave estilzon 12\"","und",2],
    ["R01-425","Llaves mixtas","jgo",1],
    ["R01-426","Prensa trípode con cadena","und",1],
    ["R01-427","Trípode para tubería","und",4],
    ["R01-428","Mantas ignifuga","und",6],
    ["R01-429","Carpa ignifuga con sus estructuras","und",1],
    ["R01-430","Abrazadera para armar tuberia de 3\"","und",1],
    ["R01-431","Abrazadera para armar tuberia de 2\"","und",1],
    ["R01-432","Arnés de cuerpo entero","und",8],
    ["R01-433","Líneas de metal con absorbedor de impacto para soldador","und",2],
    ["R01-434","Líneas con adsobedor de impacto","und",4],
    ["R01-435","Tambor rectactil","und",2],
    ["R01-436","Anclaje químico Sika AnchorFix®-3001 x 600ml","paq",2],
    ["R01-437","Mortero de nivelación SikaGrout®-212 en bolsa de 30 kg","bls",3],
    ["R01-438","Perno de expansión 1/2\" x 3\"","und",44],
    ["R01-439","Perno de expansión 3/4\" x 5\"","und",32],
    ["R01-440","Perno de expansión 1/2\" x 5\"","und",28],
    ["R01-441","Perno de expansión 5/8\" x 4\"","und",24],
    ["R01-442","Perno de expansión 5/8\" x 4\"","und",24],
    ["R01-443","Cinta ducto color plomo(cinta de secuestrador)","und",6],
    ["R01-444","Hojas A3","cja",1],
    ["R01-445","Candado grande","und",1],
    ["R01-446","VERTICAL 3M","und",36],
    ["R01-447","VERTICAL 2M","und",146],
    ["R01-448","VERTICAL 1M","und",28],
    ["R01-449","HORIZONTAL 2.57M","und",352],
    ["R01-450","HORIZONTAL 1.09M","und",352],
    ["R01-451","HORIZONTAL 0.73M","und",24],
    ["R01-452","DIAGONAL 3.18M","und",88],
    ["R01-453","DIAGONAL 2.25M","und",50],
    ["R01-454","PLATAFORMA 2.57M","und",86],
    ["R01-455","PLATAFORMA ROBUSTA 2.57M","und",34],
    ["R01-456","RODAPIES 2.57M","und",80],
    ["R01-457","SOLERAS 0.19M","und",8],
    ["R01-458","RODAPIES 1.09M","und",62],
    ["R01-459","SUPLATORIA 2.57M","und",10],
    ["R01-460","BASES REGULABLES","und",50],
    ["R01-461","BASES COLLARIN","und",50],
    ["R01-462","GRAPAS GIRATORIAS","und",46],
    ["R01-463","GRAPAS FIJAS","und",54],
    ["R01-464","GRAPAS VIGAS","und",40],
    ["R01-465","ESCALERA INDIVIDUAL","und",8],
    ["R01-466","TACOS DE MADERA 30x30x2\"","und",38],
    ["R01-467","CUBRE HUECOS 1.09M","und",32],
    ["R01-468","GRAPAS ROSETAS","und",20],
    ["R01-469","MENSULA 1.09M","und",16],
    ["R01-470","MENSULA 0.73M","und",8],
    ["R01-471","TUBOS DE 1.09M","und",32],
    ["R01-472","TUBOS DE 0.73M","und",6],
    ["R01-473","Perno + tuerca y arandela 1 1/4 x 1\" glv.","und",100],
    ["R01-474","ARNES DE CUERPO CON LÍNEA DE VIDA,CORREA ANTITRAUMA Y FAJA RETRÁCTIL ( CERTIFICADA)","jgo",3],
    ["R01-475","FAJA DE ANCLAJE DE 2MTRS (certificada)","und",2],
    ["R01-476","STICKERS ADHESIVOS (220V) - 5cmx15cm","und",10],
    ["R01-477","STICKERS ADHESIVOS (220V) - 2cmx6cm","und",30],
    ["R01-478","STICKERS ADHESIVOS (220V) - 1cmx4cm","und",50],
    ["R01-479","STICKERS ADHESIVOS (RIESGO ELÉCTRICO CON LOGO ELÉCTRICO) - 25X20cm","und",20],
    ["R01-480","STICKERS ADHESIVOS (RIESGO ELÉCTRICO) - 10x5cm","und",20],
    ["R01-481","STICKERS ADHESIVO DE INSPECCIÓN TRIMESTRAL","und",50],
    ["R01-482","STICKER ACRÍLICO : CPQ-COL 001 - 5X15cm (Fondo blanco, letras negras)","und",1],
    ["R01-483","STICKER ACRÍLICO : CPQ-COL 002 - 5X15cm (Fondo blanco, letras negras)","und",1],
    ["R01-484","TENAZA A TIERRA DE COBRE TIPO \"C\" ( 600A )","und",2],
    ["R01-485","SIKAFLEX GRIS 221","und",1],
    ["R01-486","APLICADOR DE SILICONA","und",1],
    ["R01-487","BLOQUEO DE MANIJA CON CANDADO","und",2],
    ["R01-488","Bandeja de hojas A4 de dos pisos","und",2],
    ["R01-489","Soldadura Cellocor AP 6011 de 1/8","kg",25],
    ["R01-490","Soldadura Supercito 7018 de 1/8","kg",25],
    ["R01-491","Cellocor punto azul de 1/8 6011","kg",10],
    ["R01-492","Soldadura Supercito de 3/32 7018","kg",10],
    ["R01-493","Soldadura Cellocor AP 3/32 6011","kg",5],
    ["R01-494","Disco de corte de 7\" de 1/8","und",25],
    ["R01-495","Disco de desbaste de 7\"","und",25],
    ["R01-496","Disco de corte de 4.5 de 1/8","und",50],
    ["R01-497","Discos de desbaste de 4.5","und",25],
    ["R01-498","Polifan de 4.5","und",25],
    ["R01-499","Polifan de 7\"","und",15],
    ["R01-500","Conos de seguridad","und",20],
    ["R01-501","Meneques macho A-2P + IP67","und",6],
    ["R01-502","Cinta teflón de 1/2","und",20],
    ["R01-503","Formador de empaquetadura","und",4],
    ["R01-504","WD-40","und",4],
    ["R01-505","Tapón de 1/2 hembra roscable acero al carbono","und",6],
    ["R01-506","Tapón de 1\" macho roscable acero al carbono","und",3],
    ["R01-507","Candado de bloqueo","und",10],
    ["R01-508","Letreros de trabajo en caliente","und",3],
    ["R01-509","Letrero de zona de exclusión con acceso autorizado","und",4],
    ["R01-510","Letrero de no acceso autorizado","und",4],
    ["R01-511","Ganchos tipo S de fierro corrugado con revestimiento de manguera","und",25],
    ["R01-512","Cable vulcanizado de 3x12 AWG para extensiones","m",100],
    ["R01-513","Meneque macho de 32 A - IP67 / 2P + T","und",2],
    ["R01-514","Bloqueo de cable ajustable","und",4],
    ["R01-515","Papel toalla","und",6],
    ["R01-516","Papel higiénico","und",24],
    ["R01-517","Archivador diagonal A4","und",6],
    ["R01-518","Chinches normales","und",1],
    ["R01-519","Porta lapiceros","und",6],
    ["R01-520","Plumones:Naranja","und",3],
    ["R01-521","Trapo amarillo","paq",1],
    ["R01-522","Silla de oficina","und",1],
    ["R01-523","Archivadores A4","und",18],
    ["R01-524","Etiquetas HMIs 6cm X9cm","und",1],
    ["R01-525","Regla de metal de 20 cm","und",1],
    ["R01-526","Regla de metal de 30 cm","und",1],
    ["R01-527","Porta documentos de MDS","und",1],
    ["R01-528","Archivador 1/2 oficio lomo ancho","und",2],
    ["R01-529","Mesas de madera para almacen de 95cm x 62cm","und",2],
    ["R01-530","Sacos para arena","sac",10],
    ["R01-531","Drida de 1/2\"","m",20],
    ["R01-532","Tomacriictes dobles con aterramiento para empotrar","und",2],
    ["R01-533","cable unipolar color verde 12awg","m",4],
    ["R01-534","llaves termomagneticas monofacicas de 16 amperios","und",2],
    ["R01-535","llave diferencial termomagenetica de 25 amperios","und",1],
    ["R01-536","Cuaderno de cargo","und",2],
    ["R01-537","Tableros A4","und",12],
    ["R01-538","Cuaderno anillado","und",2],
    ["R01-539","Bandeja para productos quimicos color negro","und",2],
    ["R01-540","Plumon grueso negro indeleble","und",3],
    ["R01-541","Cinta maskin tape gruesa","und",6],
    ["R01-542","Flexómetro de 5 m","und",2],
    ["R01-543","Flexómetro de 8 m|","und",1],
    ["R01-544","Wincha de fibra de 30 m","und",1],
    ["R01-545","Nivel de mano imantado","und",1],
    ["R01-546","Calibrador Vernier digital","und",1],
    ["R01-547","Pirometro","und",1],
    ["R01-548","Escalímetro","und",1],
    ["R01-549","Bridge Cam Gauge","und",1],
    ["R01-550","Kit tientes penetrantes","cja",1],
    ["R01-551","Medidor de espesor de película seca (DFT)","und",1],
    ["R01-552","Medidor de espesor húmedo (WFT)","und",1],
    ["R01-553","Medidor de punto de rocío","und",1],
    ["R01-554","Rugosimetro o Reloj de rugosidad","und",1],
    ["R01-555","Correctores","cja",1],
    ["R01-556","Plumon indeleble negro punta fina","cja",1],
    ["R01-557","Pioner A3 3 Anillos 65mm Blanco Artesco","und",2],
    ["R01-558","Pioner A4 2 Anillos 25mm Blanco Artesco","und",3],
    ["R01-559","Pioner Universal Artesco A4 2 Anillos 45 Mm Blanco","und",3],
    ["R01-560","Lapiceros tinta liquida azul, rojo,negro","cja",1],
    ["R01-561","Reglas de escritorio de 30cm","und",3],
    ["R01-562","Hojas A3","paq",1],
    ["R01-563","Resaltadores (verde ,rosado,naranja,amarillo)","cja",1],
    ["R01-564","Anemómetro calibrado","und",1],
    ["R01-565","Protección metatarcial","par",3],
    ["R01-566","Orejeras para casco","par",4],
    ["R01-567","Tapones auditivos","par",4],
    ["R01-568","Guantes anti vibracion","par",2],
    ["R01-569","Careta","und",6],
    ["R01-570","Respirador media cara","und",3],
    ["R01-571","Filtro para polvo 7093","par",3],
    ["R01-572","Tyvek","und",10],
    ["R01-573","Perforador A3","und",1],
    ["R01-574","Martillos andamieros","und",2],
    ["R01-575","Llaves carracas","und",2],
    ["R01-576","Niveles torpedos","und",2],
    ["R01-577","Arnés de cuerpo entero","und",2],
    ["R01-578","Tambores retráctiles","und",2],
    ["R01-579","Líneas de vida con absorbedor de impacto","und",2],
    ["R01-580","Juegos de correa anti trauma","jgo",2],
    ["R01-581","Cinturones porta herramientas","und",2],
    ["R01-582","Porta carracas","und",2],
    ["R01-583","Porta martillos","und",2],
    ["R01-584","Guantes anti impacto","par",5],
    ["R01-585","Hombreras","und",4],
    ["R01-586","DRIZA PARA HERRAMIENTAS","und",6],
    ["R01-587","FAJAS DE ANCLAJE","und",2],
    ["R01-588","GUANTES ANTIVIBRATORIOS","und",4],
    ["R01-589","METATARZALES","und",4],
    ["R01-590","Tiralinea","und",1],
    ["R01-591","Caja de bloqueo grupal","und",1],
    ["R01-592","Zapato con protección metatarsal","par",1],
    ["R01-593","Zapato con protección metatarsal","par",1],
    ["R01-594","Cadena color rojo","m",50],
    ["R01-595","Cadena color amarillo","m",50],
    ["R01-596","Conos de Seguridad","und",20],
    ["R01-597","Fierro corrugado 5/8\"","und",6],
    ["R01-598","Fierro corrugado 1/2\"","und",6],
    ["R01-599","Fierro corrugado 3/8\"","und",13],
    ["R01-600","Fenolico para encofrado, plancha 1.22*2.44","und",3],
    ["R01-601","SEPARADORES ARTESCO INDEX POLIPROPILENO 20 DIVISIONES","und",7],
    ["R01-602","ARMELLA CERRADA DE 1/2","und",4],
    ["R01-603","CANDADO DE 1/2\"","und",3],
    ["R01-604","FRANELA","m",2],
    ["R01-605","SILLAS DE OFICINA","und",2],
    ["R01-606","ARMELLA CERRADA DE 1/2","und",20],
    ["R01-607","KIT ANTEDERRAME COMPLETO","und",1],
    ["R01-608","ESCOBA Y RECOGEDOR","und",3]
  ].map(function(f){
    return {id:uid(), codigo:f[0], desc:f[1], unidad:f[2], requerido:f[3], comprado:0, entregado:0};
  });

  return {
    obra:"Reposición del sistema de floculante",
    area:"Proyectos de Capital Sostenible",
    serie:"EG07", correlativo:282,
    consolidado:cons,
    materiales:[
      {id:uid(), nombre:"Escoba", unidad:"und", stock:2},
      {id:uid(), nombre:"Recogedor", unidad:"und", stock:1},
      {id:uid(), nombre:"Candado de 20 mm", unidad:"und", stock:0}
    ],
    herramientas:[
      {id:uid(), nombre:"Amoladora 7\"", estado:"disponible", prestamo:null},
      {id:uid(), nombre:"Taladro percutor", estado:"disponible", prestamo:null},
      {id:uid(), nombre:"Llave de torque 1/2\"", estado:"disponible", prestamo:null}
    ],
    /* Las dos cuentas de administración vienen creadas: sin esto hay que
       darse de alta en cada equipo antes de poder mirar nada. La contraseña
       va en claro porque así trabaja esta página mientras no esté la base
       —lo mismo que hace con las que se crean a mano—; cámbielas cuando
       Supabase esté conectado y las guarde cifradas. */
    usuarios:[
      {id:uid(), nombre:"Joshua Amasifuén", cel:"", fc:"1352992", clave:"Joshua7280",
       puesto:"almacenero", creado:new Date().toISOString()},
      {id:uid(), nombre:"Administrador CPQ", cel:"", fc:"1332751", clave:"12345",
       puesto:"admin", creado:new Date().toISOString()}
    ],
    requerimientos:[],
    guias:[
      {id:uid(), numero:"EG07 - 00000282", fecha:"2026-08-13", transportista:"", estado:"en_camino",
       lineas:[
         {desc:"Separadores Artesco index", unidad:"und", cant:7, codigo:"R01-008"},
         {desc:"Armella cerrada de 1/2",    unidad:"und", cant:20, codigo:"R01-009"},
         {desc:"Candado de 20 mm",          unidad:"und", cant:3,  codigo:"R01-010"},
         {desc:"Escoba",                    unidad:"und", cant:3,  codigo:"R01-011"},
         {desc:"Recogedor",                 unidad:"und", cant:3,  codigo:"R01-012"}
       ]}
    ],
    movimientos:[]
  };
}

var db;
try{ db = JSON.parse(localStorage.getItem(CLAVE)) || semilla(); }catch(e){ db = semilla(); }
if(!db.consolidado) db = semilla();
if(!db.usuarios) db.usuarios = [];

function guardar(){ try{ localStorage.setItem(CLAVE, JSON.stringify(db)); }catch(e){} }

/* ---- Los equipos que ya abrieron la página se quedaron con lo que
   guardaron ese día: doce renglones de consolidado y sin ninguna cuenta.
   Nada de eso se refresca solo, porque el guardado local pisa a la semilla.

   Acá se ponen al día, pero sin borrar trabajo: el consolidado se
   reemplaza únicamente si nadie marcó todavía una compra ni una entrega.
   Si alguien ya trabajó sobre él, se respeta y esto no hace nada. ---- */
(function ponerAlDia(){
  var fresca = semilla(), tocado = false, i;
  for(i = 0; i < db.consolidado.length; i++){
    if(db.consolidado[i].comprado > 0 || db.consolidado[i].entregado > 0){ tocado = true; break; }
  }
  var cambio = false;
  if(!tocado && db.consolidado.length < fresca.consolidado.length){
    db.consolidado = fresca.consolidado;
    cambio = true;
  }
  if(asegurarAdmins()) cambio = true;
  if(cambio) guardar();
})();

/* Las dos cuentas de administración no pueden faltar nunca: si se pierden,
   nadie entra a arreglar nada y el equipo queda muerto. Se llama al abrir,
   al restaurar un respaldo y al borrar todo. Devuelve si tuvo que tocar algo.
   A las cuentas creadas a mano no las toca: solo repone las sembradas. */
function asegurarAdmins(){
  var fresca = semilla(), cambio = false, i, j;
  for(i = 0; i < fresca.usuarios.length; i++){
    var f = fresca.usuarios[i], ya = null;
    for(j = 0; j < db.usuarios.length; j++) if(db.usuarios[j].fc === f.fc) ya = db.usuarios[j];
    if(!ya){ db.usuarios.push(f); cambio = true; }
    /* la página no tiene pantalla para cambiar contraseñas: si la guardada
       difiere de la sembrada es que quedó de una versión anterior */
    else if(ya.clave !== f.clave){ ya.clave = f.clave; cambio = true; }
  }
  return cambio;
}

/* ---- La orden de borrar caché ----
   El administrador la da desde «Respaldo y poner en 0». Queda anotada en
   los datos con su fecha, no en este equipo, para que viaje: en cuanto la
   base esté conectada, la orden llega a cada celular con el resto de los
   datos y cada uno se limpia solo la primera vez que la ve.

   Se compara contra lo último que ESTE equipo ya obedeció. Sin esa marca
   el equipo se limpiaría y recargaría en bucle, porque la orden no
   caduca: se queda escrita.

   Hoy, sin base, solo actúa en el equipo donde se pulsa. No es que esté a
   medias: es que un equipo no tiene forma de hablarle a otro sin un
   servidor en medio. ---- */
(function obedecerPurga(){
  if(!db.purga) return;
  var hecha = null;
  try{ hecha = localStorage.getItem("almacen_purga_hecha"); }catch(e){}
  if(hecha === db.purga) return;
  try{ localStorage.setItem("almacen_purga_hecha", db.purga); }catch(e){}

  var limpiar = [];
  try{
    if(window.caches) limpiar.push(caches.keys().then(function(k){
      return Promise.all(k.map(function(x){ return caches.delete(x); }));
    }));
    if(navigator.serviceWorker) limpiar.push(
      navigator.serviceWorker.getRegistrations().then(function(rs){
        return Promise.all(rs.map(function(r){ return r.unregister(); }));
      }));
  }catch(e){}

  Promise.all(limpiar).catch(function(){}).then(function(){
    /* una sola recarga: la marca ya quedó puesta, no vuelve a entrar aquí */
    location.reload();
  });
})();

function aviso(t){
  var a = $("aviso-flotante");
  a.textContent = t; a.classList.add("ver");
  clearTimeout(a._t); a._t = setTimeout(function(){ a.classList.remove("ver"); }, 2600);
}

/* ---- el puente entre consolidado, inventario y kardex ---- */
function clave(t){ return String(t||"").toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g," ").trim(); }

function buscarConsolidado(desc, codigo){
  var i;
  if(codigo) for(i=0;i<db.consolidado.length;i++)
    if(db.consolidado[i].codigo === codigo) return db.consolidado[i];
  for(i=0;i<db.consolidado.length;i++)
    if(clave(db.consolidado[i].desc) === clave(desc)) return db.consolidado[i];
  return null;
}
function buscarMaterial(desc){
  for(var i=0;i<db.materiales.length;i++)
    if(clave(db.materiales[i].nombre) === clave(desc)) return db.materiales[i];
  return null;
}
function mover(tipo, desc, unidad, cant, doc, persona){
  var m = buscarMaterial(desc);
  if(!m){
    m = {id:uid(), nombre:desc, unidad:unidad||"und", stock:0};
    db.materiales.push(m);
  }
  var delta = tipo === "ingreso" ? cant : -cant;
  if(m.stock + delta < 0) throw new Error("No alcanza el stock de " + desc + ": hay " + m.stock + " " + m.unidad + ".");
  m.stock = Math.round((m.stock + delta) * 100) / 100;
  db.movimientos.unshift({id:uid(), fecha:new Date().toISOString(), tipo:tipo, item:desc,
    cant:cant, unidad:m.unidad, saldo:m.stock, doc:doc||"", persona:persona||""});
  var c = buscarConsolidado(desc);
  if(c){
    if(tipo === "ingreso") c.comprado = Math.min(c.requerido, Math.round((c.comprado+cant)*100)/100);
    else c.entregado = Math.min(c.comprado, Math.round((c.entregado+cant)*100)/100);
  }
  return m;
}

/* ============ secciones ============ */
/* Las unidades que se usan en obra. La lista se puede ampliar desde la
   propia pantalla: lo que se agregue queda guardado para la próxima. */
var UNIDADES_BASE = [
  "und","par","jgo","doc","mll",
  "m","m2","m3","rll","var","pln",
  "kg","t","L","gal",
  "cja","bls","paq","bld","sac","tbo"
];
var NOMBRE_UNIDAD = {
  und:"Unidad", par:"Par", jgo:"Juego", doc:"Docena", mll:"Millar",
  m:"Metro", m2:"Metro cuadrado", m3:"Metro cúbico", rll:"Rollo",
  var:"Varilla", pln:"Plancha", kg:"Kilogramo", t:"Tonelada",
  L:"Litro", gal:"Galón", cja:"Caja", bls:"Bolsa", paq:"Paquete",
  bld:"Balde", sac:"Saco", tbo:"Tubo"
};
/* En el Excel de la obra la misma unidad viene escrita de siete maneras:
   und, Und, UND, und., U... Todas apuntan a lo mismo. Aquí se unifican
   al cargar, así el inventario no termina con «Mts» y «m» por separado. */
var ALIAS_UNIDAD = {
  u:"und", un:"und", uni:"und", unid:"und", unidad:"und", unidades:"und", pza:"und", pzas:"und",
  par:"par", pares:"par",
  jgo:"jgo", jgos:"jgo", jgs:"jgo", juego:"jgo", juegos:"jgo",
  doc:"doc", docena:"doc", docenas:"doc",
  mll:"mll", millar:"mll", millares:"mll",
  m:"m", mt:"m", mtr:"m", mtrs:"m", mts:"m", metro:"m", metros:"m", ml:"m",
  m2:"m2", metrocuadrado:"m2", m3:"m3", metrocubico:"m3",
  rll:"rll", rollo:"rll", rollos:"rll",
  var:"var", varilla:"var", varillas:"var",
  pln:"pln", plancha:"pln", planchas:"pln",
  kg:"kg", kilo:"kg", kilos:"kg", kilogramo:"kg", kilogramos:"kg",
  t:"t", tn:"t", tonelada:"t", toneladas:"t",
  l:"L", lt:"L", lts:"L", litro:"L", litros:"L",
  gal:"gal", galon:"gal", galones:"gal",
  cja:"cja", caja:"cja", cajas:"cja",
  bls:"bls", bolsa:"bls", bolsas:"bls",
  paq:"paq", paquete:"paq", paquetes:"paq", pack:"paq", packs:"paq", pq:"paq",
  bld:"bld", balde:"bld", baldes:"bld",
  sac:"sac", saco:"sac", sacos:"sac",
  tbo:"tbo", tubo:"tbo", tubos:"tbo"
};
function normalizarUnidad(u){
  var t = String(u == null ? "" : u).trim();
  if(!t) return "und";
  var k = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
  if(ALIAS_UNIDAD[k]) return ALIAS_UNIDAD[k];
  /* «UND», «Und» y «und.» son la misma que «und»: se compara sin mayúsculas
     ni puntos contra la lista buena antes de darla por desconocida. */
  for(var i = 0; i < UNIDADES_BASE.length; i++){
    if(UNIDADES_BASE[i].toLowerCase() === k) return UNIDADES_BASE[i];
  }
  return t;
}

function unidades(){
  db.unidades = db.unidades || [];
  return UNIDADES_BASE.concat(db.unidades.filter(function(u){
    return UNIDADES_BASE.indexOf(u) < 0; }));
}
function opcionesUnidad(sel){
  return unidades().map(function(u){
    return '<option value="' + esc(u) + '"' + (u === sel ? " selected" : "") + ">" +
      esc(NOMBRE_UNIDAD[u] || u) + " (" + esc(u) + ")</option>";
  }).join("") + '<option value="__otra">Otra unidad…</option>';
}
function nuevaUnidad(){
  var u = prompt("¿Qué unidad? Escríbala corta, como se anota en la guía (ej. mll, rll, cil)");
  if(!u) return null;
  u = normalizarUnidad(u);
  if(!u) return null;
  db.unidades = db.unidades || [];
  if(unidades().indexOf(u) < 0){ db.unidades.push(u); guardar(); }
  return u;
}

var SEC = [
  {k:"requisito",  t:"Requisito",  ic:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'},
  {k:"ingreso",    t:"Ingreso",    ic:'<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>'},
  {k:"salida",     t:"Salida",     ic:'<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>'},
  {k:"prestamo",   t:"Préstamo",   ic:'<path d="M14.7 6.3a4 4 0 0 0 5 5L15 16l-3.5 3.5a2.1 2.1 0 0 1-3-3L12 13z"/>'},
  {k:"inventario", t:"Inventario", ic:'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'},
  {k:"consolidado",t:"Consolidado",ic:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/>'},
  {k:"kardex",     t:"Kardex",     ic:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'}
];
SEC.push(
  {k:"usuarios", t:"Usuarios", ic:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/>'},
  {k:"fotos", t:"Fotos y capturas", ic:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="m21 16-5-5-6 6-3-3-4 4"/>'},
  {k:"mantenimiento", t:"Respaldo y poner en 0", ic:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'},
  {k:"puestos", t:"Puestos", ic:'<path d="M17 20a5 5 0 0 0-10 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M20 20a4 4 0 0 0-3-3.8"/>'},
  {k:"revisar",  t:"Revisar", ic:'<path d="M9 11l2 2 4-4"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>'},
  {k:"despachar",t:"Despachar",  ic:'<path d="M3 12h11M10 6l6 6-6 6M17 5v14"/>'},
  {k:"guia",     t:"Guía",       ic:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'},
  {k:"comprar",  t:"Comprar",    ic:'<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a1.6 1.6 0 0 0 1.6 1.3h8.5a1.6 1.6 0 0 0 1.6-1.3L22 7H6"/>'},
  {k:"mispedidos",t:"Mis pedidos",ic:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'}
);

/* El administrador de la aplicación es uno solo, y se reconoce por su
   fotocheck. No aparece en la lista de puestos al registrarse: quien se
   dé de alta con este número lo recibe; cualquier otro, no.
   Para pasarlo a otra persona, cambie el número de aquí abajo. */
var FOTOCHECK_DUENO = "1352992";

var PUESTOS = [
  {k:"almacenero", t:"Almacenero", d:"Recibe, entrega, presta y lleva el kardex",
   ic:'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>', destacado:true},
  {k:"obra", t:"Administradora de Obra", d:"Revisa todo pedido y controla el consolidado",
   ic:'<path d="M9 11l2 2 4-4"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>'},
  {k:"jefatura", t:"Jefe de Logística", d:"Da el visto bueno, despacha y emite la guía",
   ic:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'},
  {k:"compras", t:"Asistente de Logística", d:"Compra lo aprobado y despacha a la mina",
   ic:'<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a1.6 1.6 0 0 0 1.6 1.3h8.5a1.6 1.6 0 0 0 1.6-1.3L22 7H6"/>'},
  {k:"supervisor", t:"Supervisor", d:"Pide materiales y sigue sus pedidos",
   ic:'<path d="M12 2 3 7v6c0 5 3.8 8.4 9 9 5.2-.6 9-4 9-9V7z"/>'},
  {k:"capataz", t:"Capataz", d:"Consulta qué material hay en obra",
   ic:'<path d="M17 20a5 5 0 0 0-10 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>'},
  {k:"admin", t:"Administrador de la app", d:"Ve todo y entra como cualquier puesto",
   ic:'<path d="M12 2 4 5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V5z"/><path d="m9 12 2 2 4-4"/>',
   admin:true}
];
var NOMBRE_PUESTO = {};
PUESTOS.forEach(function(p){ NOMBRE_PUESTO[p.k] = p.t; });

/* Qué ve cada cargo, en su orden */
/* El consolidado lo ven todos los que deciden algo sobre el material:
   es la única lista donde se ve qué se pidió, qué llegó y qué falta.
   Si logística no lo ve, compra a ciegas; si el almacén no lo ve, no
   sabe a qué renglón pertenece lo que está recibiendo. */
var PANEL = {
  almacenero:["requisito","ingreso","salida","prestamo","inventario","consolidado","kardex"],
  obra:      ["revisar","requisito","consolidado","inventario","kardex"],
  jefatura:  ["revisar","despachar","guia","consolidado","inventario"],
  compras:   ["comprar","despachar","consolidado","inventario"],
  supervisor:["requisito","mispedidos","inventario"],
  capataz:   ["inventario"],
  admin:     ["puestos","usuarios","consolidado","inventario","kardex","fotos","mantenimiento"]
};

var TITULO = {
  requisito:"Requisito de materiales", ingreso:"Ingreso por guía",
  salida:"Salida al frente", prestamo:"Préstamo de herramientas",
  inventario:"Inventario del almacén", consolidado:"Consolidado de obra",
  kardex:"Kardex de movimientos", revisar:"Requisitos por revisar",
  despachar:"Despachar a obra", guia:"Guías emitidas",
  comprar:"Comprar lo aprobado", mispedidos:"Mis pedidos",
  puestos:"Los puestos de la obra",
  usuarios:"Quién usa la aplicación",
  fotos:"Fotos y capturas",
  mantenimiento:"Respaldo y poner en 0"
};
var cargo = "almacenero";
var actual = PANEL[cargo][0];

function pintarMenu(){
  var pend = 0, i;
  for(i=0;i<db.guias.length;i++) if(db.guias[i].estado === "en_camino") pend++;
  var vencidos = 0;
  for(i=0;i<db.herramientas.length;i++){
    var h = db.herramientas[i];
    if(h.prestamo && h.prestamo.devolucion && h.prestamo.devolucion < hoy()) vencidos++;
  }
  var permitidas = PANEL[cargo];
  $("menu").innerHTML = SEC.filter(function(s){ return permitidas.indexOf(s.k) >= 0; })
    .sort(function(a,b){ return permitidas.indexOf(a.k) - permitidas.indexOf(b.k); })
    .map(function(s){
    var g = 0;
    if(s.k === "ingreso") g = pend;
    else if(s.k === "prestamo") g = vencidos;
    else if(s.k === "revisar") g = db.requerimientos.filter(function(r){
      return cargo === "obra" ? r.estado === "pendiente" : r.estado === "en_logistica"; }).length;
    else if(s.k === "comprar") g = db.requerimientos.filter(function(r){
      return r.estado === "aprobado"; }).length;
    return '<button class="opcion" type="button" data-sec="' + s.k + '"' +
      (s.k === actual ? ' aria-current="true"' : "") + ">" +
      '<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + s.ic + "</svg></span>" +
      "<b>" + s.t + "</b>" + (g ? '<span class="glob">' + g + "</span>" : "") + "</button>";
  }).join("");
  var bs = $("menu").querySelectorAll("[data-sec]");
  for(i=0;i<bs.length;i++) bs[i].addEventListener("click", function(){ ir(this.dataset.sec); });
}

function ir(sec){
  actual = sec;
  $("titulo").textContent = TITULO[sec];
  pintarMenu();
  VISTA[sec]();
  window.scrollTo(0,0);
}

var VISTA = {};





/* =====================================================================
   BOTÓN QUE TAMBIÉN RECIBE ARCHIVOS

   El botón de siempre —«Subir desde Excel», «Restaurar»— sigue estando
   donde estaba y haciendo lo de siempre al tocarlo. Lo que se le agrega
   es que acepta que le suelten el archivo encima: en la computadora el
   archivo llega por correo o por WhatsApp y arrastrarlo es un gesto
   menos que abrir el explorador y buscarlo.

   El paso del medio no es adorno: antes de dar por bueno un archivo se
   mira que sea lo que dice ser —un .xlsx es un zip y empieza por PK, un
   respaldo tiene que poder leerse como JSON—. Así el error sale acá, con
   el nombre del archivo delante, y no tres pantallas más adelante.

   Estados del botón: normal → comprobando → listo (con el visto, y al
   pulsarlo confirma) → hecho. Si algo no cuadra, queda en rojo con el
   motivo y al pulsarlo vuelve a empezar.
   ===================================================================== */
function botonArchivo(id, etiqueta, acepta, clase){
  return '<button class="bt ' + (clase || "") + ' recibe" type="button" id="' + id + '-bt" ' +
    'data-estado="normal" data-rotulo="' + esc(etiqueta) + '">' + esc(etiqueta) + "</button>" +
    '<input type="file" id="' + id + '" accept="' + (acepta || "") + '" hidden>';
}

/* alConfirmar(archivo) se llama cuando la persona pulsa el botón en verde */
function enlazarBotonArchivo(id, opciones){
  var o = opciones || {};
  var bt = $(id + "-bt"), inp = $(id);
  if(!bt || !inp) return;
  var listo = null;

  function pesa(x){
    return x < 1024 ? x + " B"
         : x < 1048576 ? (x/1024).toFixed(1) + " KB"
         : (x/1048576).toFixed(1) + " MB";
  }
  function corto(t){ return t.length > 26 ? t.slice(0, 23) + "…" : t; }

  function normal(){
    listo = null; inp.value = "";
    bt.dataset.estado = "normal";
    bt.textContent = bt.dataset.rotulo;
  }

  /* Lo que dice la extensión y lo que el archivo es de verdad no siempre
     coinciden: se miran los primeros bytes. */
  function comprobar(a, dictamen){
    var ext = (a.name.split(".").pop() || "").toLowerCase();
    if(o.acepta && o.acepta.indexOf("." + ext) < 0)
      return dictamen("Se esperaba " + o.acepta.replace(/,/g, " o ") + " y esto es ." + ext);
    if(!a.size) return dictamen("El archivo está vacío.");

    if(ext === "xlsx"){
      var l1 = new FileReader();
      l1.onload = function(){
        var b = new Uint8Array(l1.result);
        dictamen(b[0] === 0x50 && b[1] === 0x4B ? null
                 : "No parece un Excel: está dañado o es otro formato.");
      };
      l1.onerror = function(){ dictamen("No se pudo leer el archivo."); };
      l1.readAsArrayBuffer(a.slice(0, 4));
      return;
    }
    if(ext === "json"){
      var l2 = new FileReader();
      l2.onload = function(){
        try{ JSON.parse(l2.result); dictamen(null); }
        catch(e){ dictamen("El archivo no se puede leer: no es un respaldo válido."); }
      };
      l2.onerror = function(){ dictamen("No se pudo leer el archivo."); };
      l2.readAsText(a);
      return;
    }
    dictamen(null);
  }

  function tomar(a){
    if(!a) return;
    bt.dataset.estado = "leyendo";
    bt.textContent = "Comprobando " + corto(a.name) + "…";
    comprobar(a, function(porque){
      if(porque){
        bt.dataset.estado = "mal";
        bt.textContent = porque;
        aviso(porque);
        return;
      }
      listo = a;
      bt.dataset.estado = "listo";
      bt.textContent = "✓ " + corto(a.name) + " · " + pesa(a.size) + " — " +
                       (o.confirmar || "toque para confirmar");
    });
  }

  bt.addEventListener("click", function(){
    if(bt.dataset.estado === "listo"){
      var a = listo;
      bt.dataset.estado = "hecho";
      bt.textContent = "✓ " + corto(a.name) + " · cargado";
      if(o.alConfirmar) o.alConfirmar(a);
      setTimeout(normal, 2600);
      return;
    }
    if(bt.dataset.estado === "leyendo") return;
    if(bt.dataset.estado === "mal" || bt.dataset.estado === "hecho") normal();
    inp.click();
  });

  inp.addEventListener("change", function(e){ tomar(e.target.files && e.target.files[0]); });

  ["dragenter","dragover"].forEach(function(ev){
    bt.addEventListener(ev, function(e){ e.preventDefault(); bt.classList.add("encima"); });
  });
  ["dragleave","dragend"].forEach(function(ev){
    bt.addEventListener(ev, function(){ bt.classList.remove("encima"); });
  });
  bt.addEventListener("drop", function(e){
    e.preventDefault(); bt.classList.remove("encima");
    var f = e.dataTransfer && e.dataTransfer.files;
    if(f && f.length) tomar(f[0]);
  });

  /* Sin esto, soltar un archivo fuera del botón hace que el navegador lo
     abra y se pierda la pantalla con lo que se estaba escribiendo. */
  if(!window.__soltarBloqueado){
    window.__soltarBloqueado = true;
    ["dragover","drop"].forEach(function(ev){
      window.addEventListener(ev, function(e){
        if(!e.target.closest || !e.target.closest(".recibe")) e.preventDefault();
      });
    });
  }
}

/* ---------- foto, opcional ----------
   Una foto de celular pesa 3 MB y aquí se guardan en el propio equipo.
   Se reduce a 900 px y se comprime: queda en unos 80 KB, suficiente para
   reconocer la herramienta o el material, sin llenar la memoria. */
/* El celular de obra no siempre entrega un JPG. Un iPhone manda HEIC, una
   cámara manda TIFF, WhatsApp manda WEBP, y algún Android manda JFIF. Se
   intentan dos caminos antes de darse por vencido:

     1. createImageBitmap, que el navegador resuelve con su propio decodificador
        y abre bastante más que la etiqueta <img> —AVIF, WEBP, y HEIC donde el
        sistema lo soporta—.
     2. la etiqueta <img> de siempre, para lo que el primero no tome.

   Si ninguno abre la imagen, NO se pierde: se guarda el archivo tal cual llegó.
   Ocupa más y no se ve en miniatura, pero el que reciba el respaldo la tiene.
   Perder la foto de una herramienta prestada es peor que guardarla pesada. */
function encoger(fuente, an0, al0, listo){
  var max = 900, an = an0, al = al0;
  if(an > max || al > max){
    if(an > al){ al = Math.round(al * max / an); an = max; }
    else { an = Math.round(an * max / al); al = max; }
  }
  var c = document.createElement("canvas");
  c.width = an; c.height = al;
  c.getContext("2d").drawImage(fuente, 0, 0, an, al);
  try{ listo(c.toDataURL("image/jpeg", 0.7)); }
  catch(e){ listo(null); }
}

function prepararFoto(archivo, listo){
  function tal_cual(){
    /* último recurso: el archivo entero, sin tocar */
    var l = new FileReader();
    l.onload = function(){ listo(l.result, archivo.type || "", true); };
    l.onerror = function(){ listo(null); };
    l.readAsDataURL(archivo);
  }

  function porEtiqueta(){
    var lector = new FileReader();
    lector.onload = function(){
      var img = new Image();
      img.onload = function(){
        encoger(img, img.width, img.height, function(d){
          if(d) listo(d, "image/jpeg", false); else tal_cual();
        });
      };
      img.onerror = tal_cual;
      img.src = lector.result;
    };
    lector.onerror = function(){ listo(null); };
    lector.readAsDataURL(archivo);
  }

  if(window.createImageBitmap){
    createImageBitmap(archivo).then(function(bm){
      encoger(bm, bm.width, bm.height, function(d){
        if(bm.close) bm.close();
        if(d) listo(d, "image/jpeg", false); else porEtiqueta();
      });
    }).catch(porEtiqueta);
  } else porEtiqueta();
}

/* Campo de foto: se pinta donde se le diga y guarda en una variable */
/* Dos entradas de archivo, no una. La diferencia está en `capture`: con él
   el celular abre la cámara directamente y NO deja llegar a la galería; sin
   él ofrece la galería y los archivos. Tenerlas juntas era el problema: el
   almacenero que ya tenía la foto tomada no podía elegirla.

   El `accept` lleva las extensiones sueltas además de image/*: hay Android
   que no reconoce el HEIC del iPhone como imagen y lo oculta del explorador
   si no se lo nombra. */
var ACEPTA_FOTO = "image/*,.jpg,.jpeg,.jfif,.pjpeg,.png,.gif,.webp,.avif," +
                  ".heic,.heif,.bmp,.tif,.tiff,.svg";

function campoFoto(id, etiqueta){
  return '<div class="campo"><span>' + etiqueta + " <em style='font-weight:400;" +
    "text-transform:none;letter-spacing:0;color:var(--tinta3)'>· opcional</em></span>" +
    '<input type="file" id="' + id + '" accept="' + ACEPTA_FOTO + '" hidden>' +
    '<input type="file" id="' + id + '-cam" accept="' + ACEPTA_FOTO + '" capture="environment" hidden>' +
    '<div class="botones" style="margin:0">' +
      '<button class="bt pri recibe" type="button" id="' + id + '-camara">Tomar foto</button>' +
      '<button class="bt recibe" type="button" id="' + id + '-galeria">Elegir de la galería</button>' +
    "</div>" +
    '<div id="' + id + '-vista"></div></div>';
}

var fotos = {};
function enlazarFoto(id){
  var inp = $(id), cam = $(id + "-cam"), vista = $(id + "-vista");
  var bCam = $(id + "-camara"), bGal = $(id + "-galeria");
  if(!inp || !bCam || !bGal) return;

  function tomar(a){
    if(!a) return;
    bGal.textContent = "Procesando…";
    prepararFoto(a, function(dato, tipo, sinTocar){
      bGal.textContent = "Elegir de la galería";
      if(!dato) return aviso("No se pudo leer esa imagen.");
      fotos[id] = dato;
      var esVisible = !sinTocar || /^image\//.test(tipo || "");
      vista.innerHTML = '<div style="margin-top:9px;display:flex;align-items:center;gap:10px">' +
        (esVisible
          ? '<img src="' + dato + '" alt="" style="width:66px;height:66px;object-fit:cover;' +
            'border-radius:10px;border:1px solid var(--linea)">'
          : '<span class="marca-est est-info">sin vista previa</span>') +
        '<div style="flex:1;min-width:0"><b style="display:block;font-size:13px;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.name) + "</b>" +
        '<small style="color:var(--tinta2)">' +
        (sinTocar ? "Guardada tal cual: el navegador no supo achicar ese formato" : "Lista") +
        "</small></div>" +
        '<button class="bt chico" type="button" id="' + id + '-quitar">Quitar</button></div>';
      $(id + "-quitar").addEventListener("click", function(){
        fotos[id] = null; vista.innerHTML = ""; inp.value = ""; if(cam) cam.value = "";
      });
    });
  }

  bCam.addEventListener("click", function(){ (cam || inp).click(); });
  bGal.addEventListener("click", function(){ inp.click(); });
  inp.addEventListener("change", function(e){ tomar(e.target.files && e.target.files[0]); });
  if(cam) cam.addEventListener("change", function(e){ tomar(e.target.files && e.target.files[0]); });

  /* los dos botones reciben la imagen arrastrada */
  [bCam, bGal].forEach(function(b){
    ["dragenter","dragover"].forEach(function(ev){
      b.addEventListener(ev, function(e){ e.preventDefault(); b.classList.add("encima"); });
    });
    ["dragleave","dragend"].forEach(function(ev){
      b.addEventListener(ev, function(){ b.classList.remove("encima"); });
    });
    b.addEventListener("drop", function(e){
      e.preventDefault(); b.classList.remove("encima");
      var f = e.dataTransfer && e.dataTransfer.files;
      if(f && f.length) tomar(f[0]);
    });
  });
}

function miniFoto(dato){
  if(!dato) return "";
  return '<img src="' + dato + '" alt="foto" data-ver="' + dato +
    '" style="width:34px;height:34px;object-fit:cover;border-radius:7px;' +
    'border:1px solid var(--linea);cursor:pointer;vertical-align:middle">';
}
function verFotos(){
  var ims = window.document.querySelectorAll("[data-ver]"), i;
  for(i=0;i<ims.length;i++) ims[i].addEventListener("click", function(){
    var v = window.document.createElement("div");
    v.style.cssText = "position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.9);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out";
    v.innerHTML = '<img src="' + this.dataset.ver + '" alt="" style="max-width:100%;' +
      'max-height:100%;border-radius:12px">';
    v.addEventListener("click", function(){ v.remove(); });
    window.document.body.appendChild(v);
  });
}

/* ---------- escribir el Excel del requisito ----------
   Un .xlsx es un zip con XML adentro. Se arma a mano, sin comprimir
   (método 0, que el formato admite), así no hace falta ninguna librería
   ni que el navegador traiga CompressionStream. */
var TABLA_CRC = (function(){
  var t = new Uint32Array(256), c, n, k;
  for(n = 0; n < 256; n++){
    c = n;
    for(k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes){
  var c = 0xFFFFFFFF;
  for(var i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function armarZip(archivos){
  var cod = new TextEncoder(), partes = [], central = [], desp = 0;
  archivos.forEach(function(a){
    var nombre = cod.encode(a.nombre), datos = cod.encode(a.texto), c = crc32(datos);
    var loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true);
    loc.setUint16(6, 0, true); loc.setUint16(8, 0, true);        /* sin comprimir */
    loc.setUint16(10, 0, true); loc.setUint16(12, 0, true);
    loc.setUint32(14, c, true);
    loc.setUint32(18, datos.length, true); loc.setUint32(22, datos.length, true);
    loc.setUint16(26, nombre.length, true); loc.setUint16(28, 0, true);
    partes.push(new Uint8Array(loc.buffer), nombre, datos);

    var cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint16(8, 0, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, 0, true); cen.setUint16(14, 0, true);
    cen.setUint32(16, c, true);
    cen.setUint32(20, datos.length, true); cen.setUint32(24, datos.length, true);
    cen.setUint16(28, nombre.length, true);
    cen.setUint32(42, desp, true);
    central.push(new Uint8Array(cen.buffer), nombre);
    desp += 30 + nombre.length + datos.length;
  });

  var tamCentral = central.reduce(function(t, p){ return t + p.length; }, 0);
  var fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, desp, true);

  return new Blob(partes.concat(central, [new Uint8Array(fin.buffer)]),
    {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}

function letraCol(n){
  var s = "";
  n++;
  while(n > 0){ var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}
function xmlSeguro(t){
  return String(t == null ? "" : t)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,"");
}

/* filas: matriz. estilos: números de fila (base 1) que van en negrita */
function crearXLSX(filas, estilos, anchos){
  estilos = estilos || [];
  var hoja = "";
  filas.forEach(function(fila, i){
    var celdas = "";
    (fila || []).forEach(function(v, c){
      if(v === "" || v == null) return;
      var ref = letraCol(c) + (i + 1);
      var est = estilos.indexOf(i + 1) >= 0 ? ' s="1"' : "";
      if(typeof v === "number" && isFinite(v))
        celdas += '<c r="' + ref + '"' + est + "><v>" + v + "</v></c>";
      else
        celdas += '<c r="' + ref + '" t="inlineStr"' + est +
                  "><is><t xml:space=\"preserve\">" + xmlSeguro(v) + "</t></is></c>";
    });
    hoja += '<row r="' + (i + 1) + '">' + celdas + "</row>";
  });

  var cols = "";
  if(anchos && anchos.length){
    cols = "<cols>" + anchos.map(function(a, i){
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + a + '" customWidth="1"/>';
    }).join("") + "</cols>";
  }

  return armarZip([
    {nombre:"[Content_Types].xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>"},
    {nombre:"_rels/.rels", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>"},
    {nombre:"xl/workbook.xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Requerimiento" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {nombre:"xl/_rels/workbook.xml.rels", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>"},
    {nombre:"xl/styles.xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="2"><xf xfId="0"/><xf fontId="1" applyFont="1" xfId="0"/></cellXfs>' +
      "</styleSheet>"},
    {nombre:"xl/worksheets/sheet1.xml", texto:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      cols + "<sheetData>" + hoja + "</sheetData></worksheet>"}
  ]);
}

function bajarBlob(nombre, blob){
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
}

/* El requisito, con la cabecera y las filas en blanco de la plantilla */
function excelRequisito(r){
  var filas = [
    ["REQUERIMIENTO DE MATERIALES"],
    [],
    ["Obra:", db.obra, "", "", "", "FECHA DE SOLICITUD:", fecha(r.fecha)],
    ["ÁREA :", r.area || db.area, "", "", "", "FECHA DE ENTREGA:", ""],
    ["SUPERVISOR :", r.solicitante],
    [],
    ["N°","DESCRIPCIÓN","UND","CANTIDAD","ENTREGA","ENTREGA","LUGAR/FRENTE","AUTORIZADO","OBSERVACIONES"],
    ["","","","SOLICITADA","PARCIAL","TOTAL","",""]
  ];
  r.items.forEach(function(i, n){
    filas.push([n + 1, i.desc, i.und || "und", num(i.cant), "", "",
                i.frente || r.frente || "", "", i.obs || ""]);
  });
  /* filas en blanco hasta 15, como en la plantilla impresa */
  for(var n = r.items.length; n < 15; n++) filas.push([n + 1, "", "", "", "", "", "", "", ""]);

  return crearXLSX(filas, [1, 7, 8], [6, 46, 8, 12, 12, 12, 18, 14, 30]);
}

/* ---------- leer el Excel del requerimiento ----------
   Un .xlsx es un zip con las celdas en XML. Se descomprime con lo que
   el propio navegador trae, sin librerías. También acepta .csv, que es
   lo que sale cuando alguien guarda la plantilla desde el celular. */
function inflar(bytes){
  if(typeof DecompressionStream === "undefined")
    return Promise.reject(new Error("Este navegador no puede abrir .xlsx. Guarde la plantilla como CSV."));
  var flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(flujo).arrayBuffer().then(function(b){ return new Uint8Array(b); });
}

function abrirZip(buffer){
  var d = new DataView(buffer), u8 = new Uint8Array(buffer);
  var fin = -1;
  for(var i = buffer.byteLength - 22; i >= 0; i--){
    if(d.getUint32(i, true) === 0x06054b50){ fin = i; break; }
  }
  if(fin < 0) return Promise.reject(new Error("El archivo no parece un Excel."));
  var total = d.getUint16(fin + 10, true), ini = d.getUint32(fin + 16, true);
  var archivos = [], p = ini, dec = new TextDecoder();
  for(var n = 0; n < total; n++){
    var nl = d.getUint16(p + 28, true), el = d.getUint16(p + 30, true),
        cl = d.getUint16(p + 32, true), off = d.getUint32(p + 42, true);
    var nombre = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    archivos.push({nombre:nombre, off:off});
    p += 46 + nl + el + cl;
  }
  return Promise.all(archivos.map(function(a){
    var nl2 = d.getUint16(a.off + 26, true), el2 = d.getUint16(a.off + 28, true);
    var metodo = d.getUint16(a.off + 8, true);
    var tam = d.getUint32(a.off + 18, true);
    var datos = u8.subarray(a.off + 30 + nl2 + el2, a.off + 30 + nl2 + el2 + tam);
    if(metodo === 0) return Promise.resolve({nombre:a.nombre, texto:dec.decode(datos)});
    return inflar(datos).then(function(x){ return {nombre:a.nombre, texto:dec.decode(x)}; });
  })).then(function(lista){
    var mapa = {};
    lista.forEach(function(f){ mapa[f.nombre] = f.texto; });
    return mapa;
  });
}

function filasDeXLSX(mapa){
  var sst = [];
  if(mapa["xl/sharedStrings.xml"]){
    var re = /<si>([\s\S]*?)<\/si>/g, m;
    while((m = re.exec(mapa["xl/sharedStrings.xml"]))){
      var t = "", rt = /<t[^>]*>([\s\S]*?)<\/t>/g, x;
      while((x = rt.exec(m[1]))) t += x[1];
      sst.push(t.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"));
    }
  }
  var nombreHoja = null;
  for(var k in mapa){ if(/^xl\/worksheets\/sheet\d+\.xml$/.test(k)){ nombreHoja = k; break; } }
  if(!nombreHoja) throw new Error("El Excel no tiene hojas legibles.");
  var hoja = mapa[nombreHoja], filas = [];
  var rf = /<row[^>]*>([\s\S]*?)<\/row>/g, fr;
  while((fr = rf.exec(hoja))){
    var celdas = [], rc = /<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g, c;
    while((c = rc.exec(fr[1]))){
      var col = 0, letras = c[1];
      for(var i = 0; i < letras.length; i++) col = col * 26 + (letras.charCodeAt(i) - 64);
      col--;
      var tipo = /t="(\w+)"/.exec(c[2]);
      var v = /<v>([\s\S]*?)<\/v>/.exec(c[3]);
      var valor = "";
      if(tipo && tipo[1] === "s" && v) valor = sst[+v[1]] || "";
      else if(v) valor = v[1];
      else {
        var inl = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3]);
        if(inl) valor = inl[1];
      }
      celdas[col] = String(valor).replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">");
    }
    filas.push(celdas);
  }
  return filas;
}

function filasDeCSV(texto){
  return texto.split(/\r?\n/).filter(function(l){ return l.trim(); })
    .map(function(l){
      var sep = (l.split(";").length > l.split(",").length) ? ";" : ",";
      return l.split(sep).map(function(c){ return c.replace(/^"|"$/g,"").trim(); });
    });
}

/* Busca la fila de encabezados y saca descripción, unidad y cantidad */
function importarFilas(filas){
  var iCab = -1, col = {};
  for(var i = 0; i < Math.min(filas.length, 20); i++){
    var f = filas[i] || {}, prueba = {};
    for(var c = 0; c < (f.length || 0); c++){
      var t = clave(f[c]);
      if(!t) continue;
      if(/^descripcion|^material|^detalle/.test(t) && prueba.desc === undefined) prueba.desc = c;
      else if(/^und|^unidad/.test(t) && prueba.und === undefined) prueba.und = c;
      else if(/^cantidad|^cant|^solicitada/.test(t) && prueba.cant === undefined) prueba.cant = c;
      else if(/lugar|frente/.test(t) && prueba.frente === undefined) prueba.frente = c;
      else if(/observacion/.test(t) && prueba.obs === undefined) prueba.obs = c;
    }
    if(prueba.desc !== undefined){ iCab = i; col = prueba; break; }
  }
  if(iCab < 0) throw new Error('No encontré la columna "Descripción". Use la plantilla de la obra.');

  var sacados = [];
  for(var n = iCab + 1; n < filas.length; n++){
    var fila = filas[n] || [];
    var desc = String(fila[col.desc] == null ? "" : fila[col.desc]).trim();
    if(!desc) continue;
    if(/^(total|firma|elaborado|revisado|aprobado)/i.test(desc)) break;
    var cant = col.cant === undefined ? 0 : num(fila[col.cant]);
    sacados.push({
      desc: desc,
      und: normalizarUnidad(col.und === undefined ? "" : fila[col.und]),
      cant: cant > 0 ? cant : "",
      frente: col.frente === undefined ? "" : String(fila[col.frente] || "").trim(),
      obs: col.obs === undefined ? "" : String(fila[col.obs] || "").trim()
    });
  }
  if(!sacados.length) throw new Error("No encontré ninguna fila con material.");
  return sacados;
}

function cargarExcel(archivo){
  var lector = new FileReader();
  lector.onload = function(){
    try{
      var pedir = function(filas){
        var traidos = importarFilas(filas);
        /* las unidades que vengan y no estén en la lista, se agregan */
        db.unidades = db.unidades || [];
        traidos.forEach(function(t){
          if(t.und && unidades().indexOf(t.und) < 0) db.unidades.push(t.und);
        });
        var vacios = itemsReq.filter(function(i){ return String(i.desc).trim(); }).length === 0;
        if(vacios) itemsReq = [];
        traidos.forEach(function(t){ itemsReq.push(t); });
        guardar();
        pintarItems();
        aviso(traidos.length + " material(es) cargados de " + archivo.name + ".");
      };
      if(/\.csv$/i.test(archivo.name)){
        pedir(filasDeCSV(new TextDecoder().decode(new Uint8Array(lector.result))));
      } else {
        abrirZip(lector.result).then(function(mapa){ pedir(filasDeXLSX(mapa)); })
          .catch(function(e){ aviso(e.message); });
      }
    }catch(e){ aviso(e.message); }
  };
  lector.readAsArrayBuffer(archivo);
}

/* ---------- REQUISITO ---------- */
var itemsReq = [];
VISTA.requisito = function(){
  $("zona").innerHTML =
    '<div class="vista"><div class="tarjeta">' +
    "<h2>Nuevo requisito</h2>" +
    '<p class="nota">Lo que pide el frente. Se llena igual que la plantilla de la obra.</p>' +
    '<div class="rejilla dos">' +
      '<label class="campo"><span>Solicitante</span><input id="rq-sol" placeholder="Ing. Ramos"></label>' +
      '<label class="campo"><span>Área</span><input id="rq-area" value="' + esc(db.area) + '"></label>' +
      '<label class="campo"><span>Lugar / frente</span><input id="rq-frente" placeholder="Poza 3"></label>' +
      '<label class="campo"><span>Fecha del pedido</span><input type="date" id="rq-fecha" value="' + hoy() + '" max="' + hoy() + '"></label>' +
    "</div>" +
    '<div class="botones"><button class="bt sec" type="button" id="rq-add">Agregar material</button>' +
    '<span class="der" id="rq-conteo"></span></div>' +
    '<div class="botones">' +
    botonArchivo("rq-archivo", "Subir desde Excel", ".xlsx,.csv") + "</div>" +
    '<div id="rq-items" style="margin-top:12px"></div>' +
    '<div class="botones"><button class="bt pri" type="button" id="rq-guardar">Registrar requisito</button></div>' +
    "</div>" +
    '<div class="tarjeta"><h2>Requisitos registrados</h2><div id="rq-lista"></div></div></div>';

  $("rq-add").addEventListener("click", function(){
    itemsReq.push({desc:"", und:"und", cant:"", frente:$("rq-frente").value, obs:""});
    pintarItems();
    var ults = $("rq-items").querySelectorAll('[data-c="desc"]');
    if(ults.length) ults[ults.length-1].focus();
  });
  enlazarBotonArchivo("rq-archivo", {acepta:".xlsx,.csv",
    confirmar:"toque para cargar los renglones",
    alConfirmar:function(a){ cargarExcel(a); }});
  $("rq-guardar").addEventListener("click", guardarReq);
  if(!itemsReq.length) itemsReq.push({desc:"", und:"und", cant:"", frente:"", obs:""});
  pintarItems();
  pintarListaReq();
};

function pintarItems(){
  var html = '<div class="tabla-caja"><table><thead><tr>' +
    "<th>N°</th><th>Descripción</th><th>Und</th><th class='n'>Cantidad</th>" +
    "<th>Lugar / frente</th><th>Observaciones</th><th></th></tr></thead><tbody>";
  for(var i=0;i<itemsReq.length;i++){
    var it = itemsReq[i];
    html += "<tr><td class='n' style='color:var(--tinta3)'>" + (i+1) + "</td>" +
      '<td style="min-width:180px"><input data-i="' + i + '" data-c="desc" value="' + esc(it.desc) + '" placeholder="Material"></td>' +
      '<td style="width:140px"><select data-i="' + i + '" data-c="und">' +
        opcionesUnidad(it.und || "und") + "</select></td>" +
      '<td style="width:96px"><input class="n" type="number" min="0" step="0.01" data-i="' + i + '" data-c="cant" value="' + esc(it.cant) + '"></td>' +
      '<td style="min-width:130px"><input data-i="' + i + '" data-c="frente" value="' + esc(it.frente) + '"></td>' +
      '<td style="min-width:150px"><input data-i="' + i + '" data-c="obs" value="' + esc(it.obs) + '"></td>' +
      '<td><button class="bt chico" type="button" data-quitar="' + i + '">Quitar</button></td></tr>';
  }
  html += "</tbody></table></div>";
  $("rq-items").innerHTML = html;

  var ins = $("rq-items").querySelectorAll("input"), i2;
  for(i2=0;i2<ins.length;i2++) ins[i2].addEventListener("input", function(){
    itemsReq[+this.dataset.i][this.dataset.c] = this.value;
    contarReq();
  });
  var sels = $("rq-items").querySelectorAll("select");
  for(i2=0;i2<sels.length;i2++) sels[i2].addEventListener("change", function(){
    var n = +this.dataset.i;
    if(this.value === "__otra"){
      var u = nuevaUnidad();
      itemsReq[n].und = u || "und";
      pintarItems();
      return;
    }
    itemsReq[n].und = this.value;
  });
  var qs = $("rq-items").querySelectorAll("[data-quitar]");
  for(i2=0;i2<qs.length;i2++) qs[i2].addEventListener("click", function(){
    itemsReq.splice(+this.dataset.quitar,1); pintarItems();
  });
  contarReq();
}
function contarReq(){
  var n = 0;
  for(var i=0;i<itemsReq.length;i++) if(String(itemsReq[i].desc).trim()) n++;
  $("rq-conteo").textContent = n + (n === 1 ? " material" : " materiales");
}

function guardarReq(){
  var buenos = itemsReq.filter(function(i){ return String(i.desc).trim() && num(i.cant) > 0; });
  if(!buenos.length) return aviso("Agregue al menos un material con su cantidad.");
  var sol = $("rq-sol").value.trim();
  if(!sol) return aviso("Escriba quién lo pide.");

  var codigo = "REQ-" + String(db.requerimientos.length + 1).padStart(3,"0");
  db.requerimientos.unshift({
    id:uid(), codigo:codigo, fecha:$("rq-fecha").value || hoy(),
    solicitante:sol, area:$("rq-area").value.trim(), frente:$("rq-frente").value.trim(),
    estado:"pendiente",
    items:buenos.map(function(i){
      return {desc:i.desc.trim(), und:i.und||"und", cant:num(i.cant), frente:i.frente, obs:i.obs};
    })
  });

  /* El consolidado es la suma de lo que pide la obra: cada supervisor
     hace el suyo, así que un pedido nuevo de algo que ya figura le suma
     al requerido, no se descuenta de lo que ya estaba previsto. */
  var nuevos = 0, sumados = 0;
  buenos.forEach(function(i){
    var c = buscarConsolidado(i.desc);
    if(c){
      c.requerido = Math.round((num(c.requerido) + num(i.cant)) * 100) / 100;
      c.pedidos = c.pedidos || [];
      c.pedidos.push({req:codigo, quien:sol, cant:num(i.cant), fecha:$("rq-fecha").value || hoy()});
      sumados++;
      return;
    }
    db.consolidado.push({id:uid(),
      codigo:"R01-" + String(db.consolidado.length + 1).padStart(3,"0"),
      desc:i.desc.trim(), unidad:i.und||"und", requerido:num(i.cant),
      comprado:0, entregado:0, adicional:true,
      pedidos:[{req:codigo, quien:sol, cant:num(i.cant), fecha:$("rq-fecha").value || hoy()}]});
    nuevos++;
  });

  guardar();
  var reg = db.requerimientos[0];
  try{
    bajarBlob("REQUISITO_" + codigo + ".xlsx", excelRequisito(reg));
  }catch(e){ /* si el navegador no deja bajar, el pedido igual quedó guardado */ }
  itemsReq = [{desc:"", und:"und", cant:"", frente:"", obs:""}];
  VISTA.requisito();
  var detalle = [];
  if(sumados) detalle.push(sumados + " sumado(s) al consolidado");
  if(nuevos)  detalle.push(nuevos + " nuevo(s) en el consolidado");
  aviso(codigo + " registrado · Excel descargado" +
        (detalle.length ? " · " + detalle.join(" · ") : "") + ".");
}

function pintarListaReq(){
  if(!db.requerimientos.length){
    $("rq-lista").innerHTML = '<div class="vacio">Todavía no hay requisitos.</div>'; return;
  }
  $("rq-lista").innerHTML = '<div class="tabla-caja"><table><thead><tr>' +
    "<th>Código</th><th>Fecha</th><th>Solicitante</th><th>Frente</th><th class='n'>Materiales</th><th></th>" +
    "</tr></thead><tbody>" +
    db.requerimientos.map(function(r){
      return "<tr><td><b>" + esc(r.codigo) + "</b></td><td>" + fecha(r.fecha) + "</td>" +
        "<td>" + esc(r.solicitante) + "</td><td>" + esc(r.frente || "—") + "</td>" +
        "<td class='n'>" + r.items.length + "</td>" +
        '<td style="width:1%"><button class="bt chico" type="button" data-xls="' + r.id +
        '">Excel</button></td></tr>';
    }).join("") + "</tbody></table></div>";

  var xs = $("rq-lista").querySelectorAll("[data-xls]"), i;
  for(i=0;i<xs.length;i++) xs[i].addEventListener("click", function(){
    var r = db.requerimientos.filter(function(x){ return x.id === this.dataset.xls; }.bind(this))[0];
    bajarBlob("REQUISITO_" + r.codigo + ".xlsx", excelRequisito(r));
    aviso("Excel de " + r.codigo + " descargado.");
  });
}

/* ---------- INGRESO ---------- */
var conteo = null;
VISTA.ingreso = function(){
  var enCamino = db.guias.filter(function(g){ return g.estado === "en_camino"; });
  var html = '<div class="vista">';

  if(!conteo){
    html += '<div class="tarjeta"><h2>Guías por recibir</h2>' +
      '<p class="nota">Elija la guía que bajó del camión. Los renglones ya vienen con su código.</p>';
    html += enCamino.length
      ? '<div class="tabla-caja"><table><thead><tr><th>Guía</th><th>Fecha</th>' +
        "<th class='n'>Renglones</th><th></th></tr></thead><tbody>" +
        enCamino.map(function(g){
          return "<tr><td><b>" + esc(g.numero) + "</b></td><td>" + fecha(g.fecha) + "</td>" +
            "<td class='n'>" + g.lineas.length + "</td>" +
            '<td><button class="bt chico pri" type="button" data-abrir="' + g.id + '">Contar</button></td></tr>';
        }).join("") + "</tbody></table></div>"
      : '<div class="vacio">No hay guías en camino.</div>';
    html += '<div class="botones"><button class="bt" type="button" id="in-sin">Recibir sin guía</button></div></div>';
  } else {
    html += '<div class="tarjeta"><h2>' + esc(conteo.numero || "Sin guía") + "</h2>" +
      '<p class="nota">Escriba lo que contó de verdad. Entra al almacén lo contado, no lo declarado.</p>' +
      '<div class="tabla-caja"><table><thead><tr><th>Material</th><th class="n">Guía dice</th>' +
      '<th class="n">Contado</th><th>Estado</th></tr></thead><tbody>' +
      conteo.lineas.map(function(l,i){
        return "<tr><td>" + esc(l.desc) + "</td>" +
          "<td class='n' style='color:var(--tinta2)'>" + l.cant + " " + esc(l.unidad) + "</td>" +
          '<td style="width:108px"><input class="n" type="number" min="0" step="0.01" data-l="' + i +
            '" value="' + (l.contado == null ? "" : l.contado) + '"></td>' +
          '<td data-est="' + i + '"></td></tr>';
      }).join("") + "</tbody></table></div>" +
      '<div class="botones"><button class="bt" type="button" id="in-volver">Volver</button>' +
      '<button class="bt pri" type="button" id="in-registrar">Registrar ingreso</button>' +
      '<span class="der" id="in-resumen"></span></div>' +
      '<div class="aviso"><p>Lo que falte queda pendiente en el consolidado y <b>no</b> entra al almacén.</p></div>' +
      "</div>";
  }
  html += "</div>";
  $("zona").innerHTML = html;

  var i;
  if(!conteo){
    var ab = $("zona").querySelectorAll("[data-abrir]");
    for(i=0;i<ab.length;i++) ab[i].addEventListener("click", function(){
      var g = db.guias.filter(function(x){ return x.id === this.dataset.abrir; }.bind(this))[0];
      conteo = {id:g.id, numero:g.numero, lineas:g.lineas.map(function(l){
        return {desc:l.desc, unidad:l.unidad, cant:l.cant, codigo:l.codigo, contado:null}; })};
      VISTA.ingreso();
    });
    $("in-sin").addEventListener("click", function(){
      conteo = {id:null, numero:"Sin guía", lineas:[]};
      var d = prompt("¿Qué material llegó?");
      if(!d){ conteo = null; return; }
      var c = prompt("¿Cuántos?");
      conteo.lineas.push({desc:d, unidad:"und", cant:num(c), codigo:"", contado:num(c)});
      VISTA.ingreso();
    });
  } else {
    var ins = $("zona").querySelectorAll("[data-l]");
    for(i=0;i<ins.length;i++) ins[i].addEventListener("input", function(){
      conteo.lineas[+this.dataset.l].contado = this.value === "" ? null : num(this.value);
      pintarEstados();
    });
    $("in-volver").addEventListener("click", function(){ conteo = null; VISTA.ingreso(); });
    $("in-registrar").addEventListener("click", registrarIngreso);
    pintarEstados();
  }
};

function pintarEstados(){
  var falta = 0, ok = 0, sin = 0;
  conteo.lineas.forEach(function(l,i){
    var td = $("zona").querySelector('[data-est="' + i + '"]');
    var t = "", c = "";
    if(l.contado == null){ t = "sin verificar"; c = "est-info"; sin++; }
    else if(l.contado >= l.cant){ t = "conforme"; c = "est-ok"; ok++; }
    else if(l.contado > 0){ t = "faltan " + Math.round((l.cant-l.contado)*100)/100; c = "est-alerta"; falta++; }
    else { t = "no llegó"; c = "est-mal"; falta++; }
    if(td) td.innerHTML = '<span class="marca-est ' + c + '">' + t + "</span>";
  });
  var r = $("in-resumen");
  if(r) r.textContent = ok + " conformes · " + falta + " con diferencia · " + sin + " sin verificar";
}

function registrarIngreso(){
  var entran = conteo.lineas.filter(function(l){ return l.contado > 0; });
  if(!entran.length) return aviso("No hay nada contado para registrar.");
  var faltan = conteo.lineas.filter(function(l){ return !l.contado || l.contado < l.cant; });
  if(faltan.length && !confirm(faltan.length + " renglón(es) no llegaron completos. ¿Registrar igual?")) return;

  try{
    entran.forEach(function(l){ mover("ingreso", l.desc, l.unidad, l.contado, conteo.numero, ""); });
  }catch(e){ return aviso(e.message); }

  if(conteo.id){
    var g = db.guias.filter(function(x){ return x.id === conteo.id; })[0];
    if(g) g.estado = faltan.length ? "parcial" : "recibida";
  }
  guardar();
  var n = entran.length;
  conteo = null;
  VISTA.ingreso(); pintarMenu();
  aviso(n + " material(es) al almacén" + (faltan.length ? " · " + faltan.length + " pendiente(s)" : "") + ".");
}

/* ---------- SALIDA ---------- */
VISTA.salida = function(){
  var conStock = db.materiales.filter(function(m){ return m.stock > 0; });
  $("zona").innerHTML = '<div class="vista"><div class="tarjeta">' +
    "<h2>Entregar al frente</h2>" +
    '<p class="nota">Descuenta del almacén y suma a lo entregado en el consolidado.</p>' +
    '<div class="rejilla dos">' +
      '<label class="campo"><span>Material</span><select id="sa-mat">' +
        (conStock.length
          ? conStock.map(function(m){ return '<option value="' + esc(m.nombre) + '">' + esc(m.nombre) +
              " · " + m.stock + " " + esc(m.unidad) + "</option>"; }).join("")
          : '<option value="">No hay stock</option>') +
      "</select></label>" +
      '<label class="campo"><span>Cantidad</span><input class="n" type="number" min="0.01" step="0.01" id="sa-cant"></label>' +
      '<label class="campo"><span>Quién recibe</span><input id="sa-quien" placeholder="Nombre del trabajador"></label>' +
      '<label class="campo"><span>Lugar / frente</span><input id="sa-frente" placeholder="Poza 3"></label>' +
      campoFoto("sa-foto", "Foto del material") +
    "</div>" +
    '<div class="botones"><button class="bt pri" type="button" id="sa-ok">Registrar salida</button></div>' +
    "</div>" +
    '<div class="tarjeta"><h2>Últimas salidas</h2><div id="sa-lista"></div></div></div>';

  enlazarFoto("sa-foto");
  $("sa-ok").addEventListener("click", function(){
    var d = $("sa-mat").value, c = num($("sa-cant").value), q = $("sa-quien").value.trim();
    if(!d) return aviso("No hay material con stock.");
    if(c <= 0) return aviso("Escriba la cantidad.");
    if(!q) return aviso("Escriba quién recibe.");
    try{
      var mv = mover("salida", d, "", c, "", q);
      var ult = db.movimientos[0];
      ult.frente = $("sa-frente").value.trim();
      if(fotos["sa-foto"]) ult.foto = fotos["sa-foto"];
    }catch(e){ return aviso(e.message); }
    fotos["sa-foto"] = null;
    guardar(); VISTA.salida();
    aviso(c + " de " + d + " entregados a " + q + ".");
  });

  var sal = db.movimientos.filter(function(m){ return m.tipo === "salida"; }).slice(0,8);
  $("sa-lista").innerHTML = sal.length
    ? '<div class="tabla-caja"><table><thead><tr><th>Fecha</th><th>Material</th>' +
      "<th class='n'>Cantidad</th><th>Recibió</th></tr></thead><tbody>" +
      sal.map(function(m){ return "<tr><td>" + fecha(m.fecha) + "</td>" +
        "<td>" + miniFoto(m.foto) + " " + esc(m.item) + "</td>" +
        "<td class='n'>" + m.cant + " " + esc(m.unidad) + "</td><td>" + esc(m.persona) + "</td></tr>"; }).join("") +
      "</tbody></table></div>"
    : '<div class="vacio">Todavía no hay salidas.</div>';
  verFotos();
};

/* ---------- PRÉSTAMO ---------- */
/* Casi nadie se lleva una sola herramienta: el que viene por la amoladora
   se lleva también el disco y la llave. Por eso se arma una lista y todas
   salen juntas, a nombre de la misma persona y con la misma fecha. */
var seLlevan = [];
VISTA.prestamo = function(){
  var libres = db.herramientas.filter(function(h){
    return h.estado === "disponible" && seLlevan.indexOf(h.id) < 0; });
  var fuera = db.herramientas.filter(function(h){ return h.estado === "prestada"; });

  $("zona").innerHTML = '<div class="vista"><div class="tarjeta">' +
    "<h2>Prestar herramientas</h2>" +
    '<p class="nota">Puede agregar varias a la vez: todas salen a nombre de la misma persona.</p>' +
    '<div class="rejilla dos">' +
      '<label class="campo"><span>Responsable</span><input id="pr-quien" placeholder="Nombre y apellido" value="' +
        esc(window._prQuien || "") + '"></label>' +
      '<label class="campo"><span>Devuelve el</span><input type="date" id="pr-fecha" value="' +
        (window._prFecha || hoy()) + '"></label>' +
      campoFoto("pr-foto", "Foto de las herramientas") +
    "</div>" +
    '<div class="rejilla dos" style="margin-top:11px">' +
      '<label class="campo"><span>Herramienta</span><select id="pr-her">' +
        (libres.length ? libres.map(function(h){
            return '<option value="' + esc(h.id) + '">' + esc(h.nombre) + "</option>"; }).join("")
          : '<option value="">No queda ninguna disponible</option>') + "</select></label>" +
      '<div class="campo"><span>&nbsp;</span><button class="bt sec" type="button" id="pr-add">' +
        "Agregar herramienta</button></div>" +
    "</div>" +

    (seLlevan.length
      ? '<div class="tabla-caja" style="margin-top:13px"><table><thead><tr>' +
        "<th>Se lleva</th><th></th></tr></thead><tbody>" +
        seLlevan.map(function(id,i){
          var h = db.herramientas.filter(function(x){ return x.id === id; })[0];
          return "<tr><td><b>" + esc(h ? h.nombre : "—") + "</b></td>" +
            '<td style="width:1%"><button class="bt chico" type="button" data-quita="' + i +
            '">Quitar</button></td></tr>';
        }).join("") + "</tbody></table></div>"
      : '<div class="aviso" style="margin-top:13px"><p>Agregue al menos una herramienta a la lista.</p></div>') +

    '<div class="botones"><button class="bt pri" type="button" id="pr-ok">' +
      "Registrar préstamo" + (seLlevan.length > 1 ? " de " + seLlevan.length : "") + "</button>" +
      '<span class="der">' + seLlevan.length + (seLlevan.length === 1 ? " herramienta" : " herramientas") + "</span></div>" +
    "</div>" +

    '<div class="tarjeta"><h2>Fuera del almacén</h2>' +
    (fuera.length
      ? '<div class="tabla-caja"><table><thead><tr><th>Herramienta</th><th>Responsable</th>' +
        "<th>Devuelve</th><th></th></tr></thead><tbody>" +
        fuera.map(function(h){
          var tarde = h.prestamo.devolucion && h.prestamo.devolucion < hoy();
          return "<tr><td>" + miniFoto(h.prestamo.foto) + " <b>" + esc(h.nombre) + "</b></td>" +
            "<td>" + esc(h.prestamo.responsable) + "</td>" +
            "<td>" + fecha(h.prestamo.devolucion) +
            (tarde ? ' <span class="marca-est est-mal">vencida</span>' : "") + "</td>" +
            '<td style="width:1%"><button class="bt chico" type="button" data-dev="' + h.id +
            '">Devolver</button></td></tr>';
        }).join("") + "</tbody></table></div>" +
        (fuera.length > 1
          ? '<div class="botones"><button class="bt" type="button" id="pr-todas">' +
            "Devolver todas las de una persona</button></div>" : "")
      : '<div class="vacio">Todas las herramientas están en el almacén.</div>') + "</div></div>";

  var recordar = function(){
    window._prQuien = $("pr-quien").value;
    window._prFecha = $("pr-fecha").value;
  };
  enlazarFoto("pr-foto");
  if(fotos["pr-foto"]){
    var v = $("pr-foto-vista");
    if(v && !v.innerHTML) v.innerHTML =
      '<div style="margin-top:9px"><img src="' + fotos["pr-foto"] + '" alt="" ' +
      'style="width:66px;height:66px;object-fit:cover;border-radius:10px;border:1px solid var(--linea)"></div>';
  }
  $("pr-quien").addEventListener("input", recordar);
  $("pr-fecha").addEventListener("change", recordar);

  $("pr-add").addEventListener("click", function(){
    var id = $("pr-her").value;
    if(!id) return aviso("No queda ninguna herramienta disponible.");
    recordar();
    seLlevan.push(id);
    VISTA.prestamo();
  });

  var qs = $("zona").querySelectorAll("[data-quita]"), i;
  for(i=0;i<qs.length;i++) qs[i].addEventListener("click", function(){
    recordar(); seLlevan.splice(+this.dataset.quita,1); VISTA.prestamo();
  });

  $("pr-ok").addEventListener("click", function(){
    var q = $("pr-quien").value.trim();
    if(!seLlevan.length) return aviso("Agregue al menos una herramienta.");
    if(!q) return aviso("Escriba el nombre del responsable.");
    var f = $("pr-fecha").value, n = seLlevan.length;
    var img = fotos["pr-foto"] || null;
    seLlevan.forEach(function(id){
      var h = db.herramientas.filter(function(x){ return x.id === id; })[0];
      if(!h) return;
      h.estado = "prestada";
      h.prestamo = {responsable:q, salida:hoy(), devolucion:f, foto:img};
    });
    seLlevan = []; window._prQuien = ""; window._prFecha = ""; fotos["pr-foto"] = null;
    guardar(); VISTA.prestamo(); pintarMenu();
    aviso(n + (n === 1 ? " herramienta prestada a " : " herramientas prestadas a ") + q + ".");
  });

  var ds = $("zona").querySelectorAll("[data-dev]");
  for(i=0;i<ds.length;i++) ds[i].addEventListener("click", function(){
    var h = db.herramientas.filter(function(x){ return x.id === this.dataset.dev; }.bind(this))[0];
    h.estado = "disponible"; h.prestamo = null;
    guardar(); VISTA.prestamo(); pintarMenu();
    aviso(h.nombre + " de vuelta en el almacén.");
  });

  verFotos();

  if($("pr-todas")) $("pr-todas").addEventListener("click", function(){
    var quien = prompt("¿De quién son las herramientas que vuelven?");
    if(!quien) return;
    var n = 0;
    db.herramientas.forEach(function(h){
      if(h.estado === "prestada" && clave(h.prestamo.responsable) === clave(quien)){
        h.estado = "disponible"; h.prestamo = null; n++;
      }
    });
    if(!n) return aviso("No hay herramientas a nombre de " + quien + ".");
    guardar(); VISTA.prestamo(); pintarMenu();
    aviso(n + (n === 1 ? " herramienta devuelta." : " herramientas devueltas."));
  });
};

/* ---------- INVENTARIO ---------- */
/* El almacén no empieza vacío: cuando la app entra a la obra ya hay
   material en el estante. Por eso se pueden dar de alta a mano, con su
   stock inicial, sin esperar a que llegue una guía. */
VISTA.inventario = function(){
  var total = db.materiales.length;
  var enCero = db.materiales.filter(function(m){ return m.stock <= 0; }).length;
  var soloMira = (cargo === "capataz" || cargo === "supervisor");

  $("zona").innerHTML = '<div class="vista">' +
    '<div class="cifras">' +
      '<div class="cifra"><b>' + total + "</b><small>materiales</small></div>" +
      '<div class="cifra"><b>' + (total - enCero) + "</b><small>con stock</small></div>" +
      '<div class="cifra"><b>' + enCero + "</b><small>en cero</small></div>" +
    "</div>" +

    (soloMira ? "" :
      '<div class="tarjeta"><h2>Agregar material al inventario</h2>' +
      '<p class="nota">Para lo que ya está en el estante o para dar de alta algo nuevo. ' +
      "Queda registrado en el kardex como ajuste de inventario.</p>" +
      '<div class="rejilla dos">' +
        '<label class="campo"><span>Material</span>' +
          '<input id="nv-nombre" placeholder="Nombre del material"></label>' +
        '<label class="campo"><span>Unidad</span>' +
          '<select id="nv-und">' + opcionesUnidad("und") + "</select></label>" +
        '<label class="campo"><span>Cantidad</span>' +
          '<input class="n" type="number" min="0" step="0.01" id="nv-cant" placeholder="0"></label>' +
        '<label class="campo"><span>Motivo</span><select id="nv-motivo">' +
          '<option value="inicial">Ya estaba en el almacén</option>' +
          '<option value="compra">Compra directa, sin guía</option>' +
          '<option value="ajuste">Corrección de conteo</option>' +
          "</select></label>" +
      "</div>" +
      '<div class="botones"><button class="bt sec" type="button" id="nv-ok">Agregar al inventario</button></div>' +
      "</div>") +

    '<div class="tarjeta"><h2>Qué hay en el almacén</h2>' +
    '<label class="campo" style="margin-bottom:12px"><span>Buscar</span>' +
    '<input id="iv-buscar" placeholder="Escriba el nombre"></label>' +
    '<div id="iv-lista"></div></div></div>';

  $("iv-buscar").addEventListener("input", pintarInv);
  pintarInv();

  if(soloMira) return;

  $("nv-und").addEventListener("change", function(){
    if(this.value === "__otra"){
      var u = nuevaUnidad();
      VISTA.inventario();
      if(u) $("nv-und").value = u;
    }
  });

  $("nv-ok").addEventListener("click", function(){
    var nombre = ($("nv-nombre").value || "").trim();
    var cant = num($("nv-cant").value);
    var und = $("nv-und").value;
    var motivo = $("nv-motivo").value;
    if(nombre.length < 2) return aviso("Escriba el nombre del material.");
    if(und === "__otra") return aviso("Elija una unidad.");
    if(cant <= 0) return aviso("Escriba la cantidad.");

    var ya = buscarMaterial(nombre);
    if(ya && !confirm("«" + ya.nombre + "» ya está en el inventario con " + ya.stock + " " +
        ya.unidad + ". ¿Le sumo " + cant + "?")) return;

    var doc = motivo === "inicial" ? "Inventario inicial"
            : (motivo === "compra" ? "Compra directa" : "Ajuste de conteo");
    try{
      mover("ingreso", nombre, und, cant, doc, "");
    }catch(e){ return aviso(e.message); }
    guardar();
    VISTA.inventario();
    aviso(cant + " " + und + " de " + nombre + " al inventario.");
  });
};

function pintarInv(){
  var q = clave($("iv-buscar") ? $("iv-buscar").value : "");
  var lista = db.materiales.filter(function(m){ return !q || clave(m.nombre).indexOf(q) >= 0; })
    .sort(function(a,b){ return a.nombre.localeCompare(b.nombre); });
  $("iv-lista").innerHTML = lista.length
    ? '<div class="tabla-caja"><table><thead><tr><th>Material</th><th class="n">Stock</th>' +
      "<th>En el consolidado</th></tr></thead><tbody>" +
      lista.map(function(m){
        var c = buscarConsolidado(m.nombre);
        var e = m.stock > 0 ? '<span class="marca-est est-ok">disponible</span>'
                            : '<span class="marca-est est-mal">sin stock</span>';
        return "<tr><td>" + esc(m.nombre) + "<br>" + e + "</td>" +
          "<td class='n'><b>" + m.stock + "</b> " + esc(m.unidad) + "</td>" +
          "<td>" + (c
            ? '<span class="marca-est est-info">' + esc(c.codigo) + "</span>"
            : '<span class="marca-est est-alerta">fuera del alcance</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div>"
    : '<div class="vacio">Sin coincidencias.</div>';
}
