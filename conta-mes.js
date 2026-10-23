// A CONTA DO MÊS (23/10, levada para o servidor): linha do tempo de 28 dias, dia a dia. Arquivo ÚNICO da conta:
// a função "mensal" usa este arquivo; a página só desenha o que volta. Enquanto CONFIG_MES.ligado = false, o publicar.sh
// sobe uma cópia no site para o ?mes=teste; ligado, o arquivo NÃO vai para o site (quem não pagou não tem a conta).
// O passe atravessa as semanas: o pacote acaba quando completa o valor (pode ser no dia 10) e o app desconta o próximo
// das primeiras corridas; o passe por tempo corre também na folga (dia parado). N = o que ele quer levar em cada dia; g = o que fazer no app.
// brlc/horas/curto/durac/validadeDe: iguais aos da página (mudou lá, mudar aqui).
export const SEMANAS = 4, DM = SEMANAS * 7;
const durac = p => Math.max(1, Math.floor(p.tam / 24 + 0.01));
const validadeDe = p => p.validade > 0 ? p.validade : 180;
const brlc = v => 'R$ ' + v.toLocaleString('pt-BR', {minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2});
const horas = p => (p.tam >= 168 || p.app == '99' && p.tam >= 48) && p.tam % 24 == 0 ? `${p.tam / 24} dias` : `${p.tam} h`;
const curto = p => p.tipo == 'tempo' ? `Passe de ${horas(p)} por ${brlc(p.preco)}` : `${brlc(p.tam)} em ganhos por ${brlc(p.preco)} de passe`;

// pacote por ganhos, comprado de novo quando acaba (ou vence): o app desconta o preço primeiro, depois a corrida é dele
function diaGanhos(p, N) {
  const g = N.map(() => 0), compras = []; let r = 0, deve = 0, desde = -1e9, perdeu = 0;
  N.forEach((n, d) => {
    if (r > 0 && d - desde >= validadeDe(p)) { perdeu += r; r = 0; deve = 0; }
    for (let falta = n, k = 0; falta > 1e-9 && k < 500; k++) {
      if (r <= 1e-9) { r = p.tam; deve = p.preco; desde = d; compras.push({d, p}); }
      const x = Math.min(deve > 0 ? deve : falta, r);
      g[d] += x; r -= x; if (deve > 0) deve -= x; else falta -= x;
    }
  });
  // o que sobrou do último pacote passa para o mês seguinte (já pago)
  return {g, compras, credito: compras.length ? p.preco * r / p.tam : 0, sobra: compras.length ? r : 0, perdeu};
}
// passe(s) por tempo: o jeito mais barato de cobrir todo dia rodado (um passe por vez; comprado num dia, cobre os seguintes)
function diaTempo(lista, N) {
  const best = Array(DM + 1).fill(null); best[DM] = {c: 0, k: []};
  for (let i = DM - 1; i >= 0; i--) {
    if (!(N[i] > 0)) { best[i] = best[i + 1]; continue; }
    lista.forEach(p => { const d = durac(p), j = Math.min(DM, i + d), fora = i + d - j, c = p.preco * (1 - fora / d) + best[j].c;
      if (!best[i] || c < best[i].c - 1e-9) best[i] = {c, k: [{d: i, p, fora}, ...best[j].k]}; });
  }
  const k = best[0].k, g = N.slice(); k.forEach(x => g[x.d] += x.p.preco);
  const parado = k.reduce((a, x) => a + Array.from({length: durac(x.p) - x.fora}, (_, j) => x.d + j).filter(d => !(N[d] > 0)).length, 0);
  return {g, compras: k, credito: k.reduce((a, x) => a + x.p.preco * x.fora / durac(x.p), 0), sobraDias: k.length ? k[k.length - 1].fora : 0, parado, perdeu: 0};
}
export function planosMes(ps, N) {
  const T = N.reduce((a, b) => a + b, 0), pl = [];
  if (!(T > 0)) return pl;
  const add = (nome, curtoTxt, tipo, r, extra = {}) => { const P = r.g.reduce((a, b) => a + b, 0);
    pl.push({nome, curto: curtoTxt, tipo, ...r, N, T, P, passe: P - T, ef: P - T - r.credito, ...extra}); };
  ps.filter(p => p.tipo != 'tempo').forEach(p => add(curto(p), `${brlc(p.tam)} em ganhos por ${brlc(p.preco)}`, 'ganhos', diaGanhos(p, N), {p}));
  // tempo: fora o que tem outro da mesma duração mais barato (nunca compensa)
  const tempos = ps.filter(p => p.tipo == 'tempo' && !ps.some(q => q !== p && q.tipo == 'tempo' && durac(q) == durac(p) && (q.preco < p.preco || q.preco == p.preco && ps.indexOf(q) < ps.indexOf(p))));
  tempos.forEach(p => add(curto(p), `${horas(p)} por ${brlc(p.preco)}`, 'tempo', diaTempo([p], N), {p}));
  if (tempos.length > 1) { const r = diaTempo(tempos, N), tipos = [...new Set(r.compras.map(x => x.p))];
    const so = Math.min(...pl.filter(x => x.tipo == 'tempo').map(x => x.ef));
    if (tipos.length > 1 && r.g.reduce((a, b) => a + b, 0) - T - r.credito < so - 1)
      add(`Misturando passes de ${tipos.sort((a, b) => a.tam - b.tam).map(horas).join(' e ')}`, `Misturando ${tipos.map(horas).join(' e ')}`, 'tempo', r, {p: tipos[0], mistura: true}); }
  // a melhor é a que pede menos no app no mês (descontado o que fica pago para o mês seguinte)
  return pl.sort((a, b) => a.ef - b.ef || a.P - b.P);
}
const contasDe = apps => apps.map(x => ({app: x.app, N: x.N, planos: planosMes(x.ofertas, x.N)})).filter(c => c.planos.length);

// folgas com a família: tira o dia, o que ele levava nele vai para os outros dias; o passe é refeito na linha do tempo
function folgasMes(contas, apps) {
  const rod = d => contas.some(c => c.N[d] > 0), pesoDia = d => contas.reduce((a, c) => a + c.N[d], 0);
  const sabs = [...Array(SEMANAS)].map((_, w) => 7 * w + 5).filter(rod), doms = [...Array(SEMANAS)].map((_, w) => 7 * w + 6).filter(rod);
  const fraco = l => l.slice().sort((a, b) => pesoDia(a) - pesoDia(b) || b - a)[0];
  const fds = [...Array(SEMANAS)].map((_, w) => [7 * w + 5, 7 * w + 6].filter(rod)).filter(l => l.length == 2).sort((a, b) => pesoDia(a[0]) + pesoDia(a[1]) - pesoDia(b[0]) - pesoDia(b[1]) || b[0] - a[0])[0];
  const ops = [];
  if (sabs.length) ops.push([`Folgar o sábado da semana ${Math.floor(fraco(sabs) / 7) + 1}`, [fraco(sabs)]]);
  if (doms.length) ops.push([`Folgar o domingo da semana ${Math.floor(fraco(doms) / 7) + 1}`, [fraco(doms)]]);
  if (fds) ops.push([`Folgar o fim de semana inteiro da semana ${Math.floor(fds[0] / 7) + 1}`, fds]);
  if (sabs.length > 1) ops.push(['Folgar todos os sábados', sabs]);
  if (doms.length > 1) ops.push(['Folgar todos os domingos', doms]);
  const P0 = contas.reduce((a, c) => a + c.planos[0].P, 0), n0 = [...Array(DM)].filter((_, d) => rod(d)).length, m0 = P0 / n0;
  const ofertas = app => apps.find(x => x.app == app).ofertas;
  const lista = ops.map(([nome, D]) => {
    const novas = contas.map(c => { const N1 = c.N.map((v, d) => D.includes(d) ? 0 : v), T1 = N1.reduce((a, b) => a + b, 0);
      return T1 > 0 ? {app: c.app, N: N1.map(v => v * c.planos[0].T / T1)} : null; });
    if (novas.some(x => !x)) return null;
    // o mês inteiro com a folga já vai pronto: "Usar esta folga" só desenha, não gasta simulação
    const contas1 = novas.map(x => ({app: x.app, N: x.N, planos: planosMes(ofertas(x.app), x.N)})), pls = contas1.map(c => c.planos[0]);
    const P1 = pls.reduce((a, x) => a + x.P, 0), n1 = [...Array(DM)].filter((_, d) => novas.some(x => x.N[d] > 0)).length, m1 = P1 / n1;
    const muda = pls.map((x, k) => x.curto != contas[k].planos[0].curto ? `Na ${contas[k].app}, o passe muda para: ${x.nome[0].toLowerCase() + x.nome.slice(1)}` : '').filter(x => x);
    return {nome, D, novas, contas: contas1, n1, m1, mais: m1 - m0, muda, P1, dif: P1 - P0};
  }).filter(f => f && f.n1 > 0 && f.m1 <= 1.8 * m0);
  return {m0, n0, lista};
}

// o que chega de fora não é confiável: só os 2 apps, até 30 ofertas com número de verdade, dias de R$ 0 a 3.000
export function validar(apps, dias) {
  if (!Array.isArray(apps) || !apps.length || apps.length > 2 || new Set(apps.map(x => x?.app)).size != apps.length) return false;
  const n = v => typeof v == 'number' && isFinite(v);
  return apps.every(x => ['Uber', '99'].includes(x.app) && Array.isArray(x.N) && x.N.length == dias && x.N.every(v => n(v) && v >= 0 && v <= 3000)
    && Array.isArray(x.ofertas) && x.ofertas.length && x.ofertas.length <= 30
    && x.ofertas.every(p => p && p.app == x.app && ['tempo', 'ganhos'].includes(p.tipo) && n(p.preco) && p.preco > 0 && p.preco <= 5000
      && n(p.tam) && p.tam >= 6 && p.tam <= 20000 && (p.validade == null || n(p.validade) && p.validade >= 1 && p.validade <= 365)));
}
// só os campos da conta (o resto da oferta fica de fora)
const limpo = apps => apps.map(x => ({app: x.app, N: x.N, ofertas: x.ofertas.map(p => ({app: p.app, tipo: p.tipo, tam: p.tam, preco: p.preco, ...(p.validade ? {validade: p.validade} : {})}))}));

// o mês pago: 28 dias de cada app → planos de cada app + folgas com a família
export function mes(apps) { apps = limpo(apps); const contas = contasDe(apps); return {contas, folgas: contas.length ? folgasMes(contas, apps) : {lista: []}}; }
// a vitrine grátis no resultado da semana: só 1 semana, repetida 4 vezes aqui dentro (não serve de mês)
export function vitrine(apps) {
  return limpo(apps.map(x => ({...x, N: [...Array(SEMANAS)].flatMap(() => x.N)}))).map(x => ({app: x.app, pl: planosMes(x.ofertas, x.N)[0]})).filter(x => x.pl);
}
