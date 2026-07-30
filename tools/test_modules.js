/* Pruebas de los modulos de calculo. Ejecutar desde la raiz del repo:
     node tools/test_modules.js
*/
const fs=require('fs'),vm=require('vm'),path=require('path');
const RAIZ=path.join(__dirname,'..');
process.chdir(RAIZ);
const g={Math,parseFloat,isFinite,String,Number,Object,Array,console,JSON};g.window=g;
vm.createContext(g);
for (const f of ['js/geo.js','js/radio.js','js/inventory.js','js/parse.js','data/sites.js'])
  vm.runInContext(fs.readFileSync(f,'utf8'),g,{filename:f});

const {Geo,Radio,Inv,Parse}=g;
let fail=0;
const ok=(c,m)=>{if(!c){console.log('  FAIL',m);fail++;}else console.log('  ok  ',m);};

console.log('--- geo distancias');
// Santiago centro -> Valparaiso ~ 100 km
const d=Geo.haversine(-33.4489,-70.6693,-33.0472,-71.6127);
ok(Math.abs(d-99.5)<3,'Stgo-Valpo '+d.toFixed(2)+' km (esperado ~100)');
const az=Geo.azimut(-33.4489,-70.6693,-33.0472,-71.6127);
ok(az>290&&az<310,'azimut Stgo->Valpo '+az.toFixed(1)+'° ('+Geo.rumboCardinal(az)+')');
// ida y vuelta destino/haversine
const p=Geo.destino(-33.44,-70.65,12.5,37);
ok(Math.abs(Geo.haversine(-33.44,-70.65,p.lat,p.lon)-12.5)<0.01,'destino/haversine coherentes');
const m=Geo.intermedio(-33.4489,-70.6693,-33.0472,-71.6127,0.5);
ok(Math.abs(Geo.haversine(-33.4489,-70.6693,m.lat,m.lon)-d/2)<0.01,'punto medio a mitad de camino');

console.log('--- UTM');
// Santiago aprox: 19S 345000 6300000
const u=Geo.utmALatLon(345000,6300000,19,'S');
ok(u.lat<-33&&u.lat>-34.5&&u.lon<-70&&u.lon>-71.5,'UTM 19S 345000/6300000 -> '+u.lat.toFixed(4)+','+u.lon.toFixed(4));

console.log('--- parseo coordenadas');
const casos=[
 ['Sitio A; -33.4433; -70.6512',-33.4433,-70.6512],
 ['Sitio A\t-33.4433\t-70.6512',-33.4433,-70.6512],
 ['Nuevo -33.4433 -70.6512 30.5',-33.4433,-70.6512],      // altura al final no debe confundirse
 ['Torre 12.5 m, -33.4433, -70.6512',-33.4433,-70.6512],
 ['Cliente 33.4433 S 70.6512 W',-33.4433,-70.6512],       // sin signo, con hemisferio
 ["X 33°26'35.9\"S 70°39'04.3\"W",-33.4433,-70.6512],
 ['Y 19S 345678 6298765',null,null],
 ['lat/lon invertidas: -70.6512, -33.4433',-33.4433,-70.6512],
];
for(const [txt,lat,lon] of casos){
  const r=Geo.parseCoords(txt);
  if(lat===null){ ok(r&&Geo.enChile(r.lat,r.lon),txt+' -> '+(r?r.lat.toFixed(4)+','+r.lon.toFixed(4)+' ['+r.formato+']':'null')); continue;}
  ok(r&&Math.abs(r.lat-lat)<0.002&&Math.abs(r.lon-lon)<0.002, txt+' -> '+(r?r.lat.toFixed(4)+','+r.lon.toFixed(4)+' ['+r.formato+'] resto="'+r.resto+'"':'null'));
}

console.log('--- inventario');
const inv=new Inv.Inventario(g.RED_INV,g.RED_META);
ok(inv.sitios.length===4532,'sitios cargados '+inv.sitios.length);
ok(!!inv.buscarId('01_001'),'buscarId 01_001');
ok(!!inv.buscarId('01-001'),'buscarId tolerante 01-001');
ok(!!inv.buscarId('01_001_4G'),'buscarId con sufijo 01_001_4G');
const cer=inv.cercanos(-33.4489,-70.6693,3,null,10);
ok(cer.length>3,'cercanos a Stgo centro en 3 km: '+cer.length);
ok(cer[0].distKm<=cer[1].distKm,'ordenados por distancia');
console.log('   mas cercano:',cer[0].sitio.id,cer[0].sitio.nombre,cer[0].distKm.toFixed(3),'km az',cer[0].az.toFixed(0));
// fuerza bruta vs grilla
let bf=null;
for(const s of inv.sitios){const dd=Geo.haversine(-33.4489,-70.6693,s.lat,s.lon); if(!bf||dd<bf.d)bf={s,d:dd};}
ok(bf.s.id===cer[0].sitio.id,'grilla coincide con fuerza bruta ('+bf.s.id+' '+bf.d.toFixed(3)+')');
// consulta en zona sin sitios (oceano) no debe romper
ok(inv.cercanos(-40,-80,50,null,5).length===0,'zona vacia devuelve 0');

console.log('--- radio: geometria');
const F=Radio.fresnel1(5,5,15);
ok(Math.abs(F-7.07)<0.1,'F1 a 10 km/15 GHz = '+F.toFixed(2)+' m (esperado 7.07 = sqrt(lambda*d1*d2/d))');
const B=Radio.bulboTierra(5,5,1.33);
ok(Math.abs(B-1.47)<0.1,'bulbo 10 km k=1.33 = '+B.toFixed(2)+' m');
ok(Radio.bulboTierra(15,15,1.33)>Radio.bulboTierra(5,5,1.33),'bulbo crece con distancia');
const fs30=Radio.fsl(30,15);
ok(Math.abs(fs30-145.5)<1,'FSL 30 km 15 GHz = '+fs30.toFixed(2)+' dB');
const G=Radio.ganancia(0.6,15);
ok(Math.abs(G-37.7)<1,'ganancia 0.6 m @15 GHz = '+G.toFixed(1)+' dBi');

console.log('--- radio: lluvia');
const c15=Radio.coefLluvia(15,'V');
ok(Math.abs(c15.k-0.05008)<1e-4&&Math.abs(c15.alfa-1.044)<1e-3,'P.838 15 GHz V k='+c15.k.toFixed(5)+' a='+c15.alfa.toFixed(4));
const c12=Radio.coefLluvia(13,'H');
ok(c12.k>0.02386&&c12.k<0.04481,'interpolacion 13 GHz H entre 12 y 15: k='+c12.k.toFixed(5));
const L=Radio.lluvia001(10,15,40,'V');
ok(L.A001>5&&L.A001<40,'A0.01 10 km 15GHz R40 = '+L.A001.toFixed(1)+' dB, gamma='+L.gamma.toFixed(2)+' dB/km');
ok(Radio.lluviaEnP(L.A001,15,0.001)>L.A001,'atenuacion crece al bajar p');
ok(Radio.lluviaEnP(L.A001,15,0.1)<L.A001,'atenuacion baja al subir p');
const pl=Radio.indispLluvia(L.A001,L.A001,15);
ok(Math.abs(pl-0.01)<0.004,'margen = A0.01 -> indisp ~0.01% (obtenido '+pl.toFixed(5)+')');
ok(Radio.indispLluvia(200,L.A001,15)===0,'margen enorme -> 0% indisp por lluvia');
ok(Radio.indispLluvia(0.5,L.A001,15)>0.05,'margen minimo -> indisp alta: '+Radio.indispLluvia(0.5,L.A001,15).toFixed(4)+'%');

console.log('--- radio: evaluacion de salto');
const ev=Radio.evalMMOO({dKm:10,banda:15,hA:30,hB:30,R001:30,diamA:0.6,diamB:0.6});
ok(ev.disponibilidad>99&&ev.disponibilidad<=100,'salto 10 km/15GHz disp='+ev.disponibilidad.toFixed(4)+'% margen='+ev.margen.toFixed(1)+' dB');
ok(ev.cumpleDespeje,'despeje ok con 30 m (req '+ev.despejeReq.toFixed(1)+' m)');
const ev2=Radio.evalMMOO({dKm:10,banda:15,hA:5,hB:5,R001:30});
ok(!ev2.cumpleDespeje&&ev2.hFaltanteA>0,'con 5 m falta altura: '+ev2.hFaltanteA.toFixed(1)+' m');
const ev3=Radio.evalMMOO({dKm:40,banda:38,hA:40,hB:40,R001:40});
ok(ev3.disponibilidad<99.9,'40 km en 38 GHz es malo: disp='+ev3.disponibilidad.toFixed(3)+'%');
const mb=Radio.mejorBanda({dKm:3,hA:30,hB:30,R001:30,dispObjetivo:99.99});
ok(mb.elegida,'3 km -> banda '+(mb.elegida&&mb.elegida.et)+' entre '+mb.opciones.length+' opciones');
const mb2=Radio.mejorBanda({dKm:35,hA:50,hB:50,R001:40,dispObjetivo:99.99});
ok(mb2.elegida&&mb2.elegida.banda<=13,'35 km -> banda baja: '+(mb2.elegida&&mb2.elegida.et));
ok(Radio.r001DeRegion('II')<Radio.r001DeRegion('X'),'lluvia norte < sur');

console.log('--- radio: FO');
const fo=Radio.evalFO({distKm:1.0,entorno:'U',costoAereo:6e6});
ok(Math.abs(fo.rutaKm-1.45)<0.01,'ruta urbana 1 km -> '+fo.rutaKm.toFixed(2)+' km');
ok(fo.postes===Math.ceil(1450/45),'postes '+fo.postes);
ok(Radio.categoriaFO(0.5).cat==='ALTA'&&Radio.categoriaFO(20).cat==='NO VIABLE','categorias FO');

console.log('--- parse de entradas');
const txt=[
 '# candidatos',
 'Cliente Norte; -33.3500; -70.6800; h=25',
 'Bodega Sur -33.6100 -70.7300',
 '01_001',
 'Cliente X -33.44,-70.65 -> 23_209',
 'basura sin nada',
].join('\n');
const P=Parse.parseEntrada(txt,inv);
ok(P.entradas.length===4,'entradas leidas '+P.entradas.length);
ok(P.errores.length===1&&P.errores[0].linea===6,'1 error en linea '+(P.errores[0]&&P.errores[0].linea));
ok(P.entradas[0].altura===25,'altura h=25 leida ('+P.entradas[0].altura+')');
ok(P.entradas[2].deRed&&P.entradas[2].sitio.id==='01_001','codigo de red resuelto');
ok(P.entradas[3].tipo==='enlace','enlace detectado: '+P.entradas[3].nombre);
const T=Parse.parseEntrada('nombre\tlat\tlon\taltura\nSitio T\t-33.45\t-70.66\t32',inv);
ok(T.entradas.length===1&&T.entradas[0].altura===32&&T.entradas[0].formato==='tabla','tabla con cabecera');

console.log(fail?('\n'+fail+' FALLAS'):'\nTODO OK');
process.exit(fail?1:0);
