// État partagé de la bascule Détaillée / Regroupée (vue macro façon PAC),
// piloté depuis deux endroits indépendants — la légende de la carte
// (map.js/main.js) et le haut du tableau d'assolement (ui-assolement.js) —
// mais une seule et même bascule : changer l'un change l'autre.
let vue = 'detail'; // 'detail' | 'groupe'
const listeners = new Set();

export function getVueLegende() {
  return vue;
}

export function setVueLegende(v) {
  const suivante = v === 'groupe' ? 'groupe' : 'detail';
  if (suivante === vue) return;
  vue = suivante;
  listeners.forEach((cb) => cb(vue));
}

export function toggleVueLegende() {
  setVueLegende(vue === 'groupe' ? 'detail' : 'groupe');
}

export function onVueLegendeChange(cb) {
  listeners.add(cb);
  cb(vue);
  return () => listeners.delete(cb);
}
