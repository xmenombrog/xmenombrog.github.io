// Team drafting, ported from SportsDatabaseML/team_balancer.py:
// assign_teams (group-by-group draft), refine_teams (balance-preserving swaps),
// balance_spread, random_team_baseline, assignment margin and suggest_team.
(function (root) {
  'use strict';

  const SKILLS = 4; // shooting, passing, defense, rebounding are features 0..3
  const FIT = 4, AVAIL = 5;
  const POSITIONS = ['Guard', 'Forward', 'Center'];
  const MIN_TEAM_SIZE = 5;
  const UNCERTAIN_MARGIN = 0.15;

  const round2 = (x) => Math.round(x * 100) / 100;
  const overallSkill = (f) => (f[0] + f[1] + f[2] + f[3]) / SKILLS;
  const maxTeams = (n) => Math.floor(n / MIN_TEAM_SIZE);

  // assign_teams: players sorted by cluster, skill (desc), id; each joins the team with
  // the fewest of their cluster, then fewest players, then fewest of their position,
  // then lowest total skill. Ties go to the lowest team number (Python's min()).
  function assignTeams(players, labels, nTeams) {
    const rows = players.map((p, i) => ({ ...p, cluster: labels[i], skill: round2(overallSkill(p.f)) }));
    rows.sort((a, b) => a.cluster - b.cluster || b.skill - a.skill || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const k = Math.max(...labels) + 1;
    const inCluster = Array.from({ length: nTeams }, () => new Array(k).fill(0));
    const inPos = Object.fromEntries(POSITIONS.map((p) => [p, new Array(nTeams).fill(0)]));
    const size = new Array(nTeams).fill(0);
    const skill = new Array(nTeams).fill(0);
    for (const r of rows) {
      let best = 0;
      for (let t = 1; t < nTeams; t++) {
        const a = [inCluster[t][r.cluster], size[t], inPos[r.pos][t], skill[t]];
        const b = [inCluster[best][r.cluster], size[best], inPos[r.pos][best], skill[best]];
        for (let i = 0; i < 4; i++) {
          if (a[i] < b[i]) { best = t; break; }
          if (a[i] > b[i]) break;
        }
      }
      r.team = best;
      inCluster[best][r.cluster] += 1;
      inPos[r.pos][best] += 1;
      size[best] += 1;
      skill[best] += r.skill;
    }
    return rows;
  }

  // refine_teams: swap players who share a cluster AND a position whenever the swap
  // moves the two teams' z-scored averages (skill, fitness, availability) closer to 0.
  function refineTeams(rows, nTeams, maxPasses = 50) {
    const vals = rows.map((r) => [r.skill, r.f[FIT], r.f[AVAIL]]);
    const n = vals.length;
    const mean = [0, 1, 2].map((j) => vals.reduce((a, v) => a + v[j], 0) / n);
    const std = [0, 1, 2].map((j) => Math.sqrt(vals.reduce((a, v) => a + (v[j] - mean[j]) ** 2, 0) / n));
    const z = vals.map((v) => v.map((x, j) => (x - mean[j]) / std[j]));
    const team = rows.map((r) => r.team);
    const sizes = new Array(nTeams).fill(0);
    const sums = Array.from({ length: nTeams }, () => [0, 0, 0]);
    team.forEach((t, i) => {
      sizes[t] += 1;
      for (let j = 0; j < 3; j++) sums[t][j] += z[i][j];
    });

    // pandas groupby(["cluster", position]).indices: groups in sorted key order
    const groupMap = new Map();
    rows.forEach((r, i) => {
      const key = `${String(r.cluster).padStart(3, '0')}|${r.pos}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(i);
    });
    const groups = [...groupMap.keys()].sort().map((key) => groupMap.get(key));

    for (let pass = 0; pass < maxPasses; pass++) {
      let improved = false;
      for (const members of groups) {
        for (let a = 0; a < members.length; a++) {
          for (let b = a + 1; b < members.length; b++) {
            const i = members[a], j = members[b];
            const ta = team[i], tb = team[j];
            if (ta === tb) continue;
            let oldS = 0, newS = 0;
            for (let d = 0; d < 3; d++) {
              const diff = z[j][d] - z[i][d];
              oldS += (sums[ta][d] / sizes[ta]) ** 2 + (sums[tb][d] / sizes[tb]) ** 2;
              newS += ((sums[ta][d] + diff) / sizes[ta]) ** 2 + ((sums[tb][d] - diff) / sizes[tb]) ** 2;
            }
            if (newS < oldS - 1e-12) {
              for (let d = 0; d < 3; d++) {
                const diff = z[j][d] - z[i][d];
                sums[ta][d] += diff;
                sums[tb][d] -= diff;
              }
              team[i] = tb;
              team[j] = ta;
              improved = true;
            }
          }
        }
      }
      if (!improved) break;
    }
    rows.forEach((r, i) => (r.team = team[i]));
    return rows;
  }

  function buildTeams(players, labels, nTeams, refine = true) {
    const rows = assignTeams(players, labels, nTeams);
    return refine ? refineTeams(rows, nTeams) : rows;
  }

  function teamSummary(rows, nTeams, k) {
    return Array.from({ length: nTeams }, (_, t) => {
      const m = rows.filter((r) => r.team === t);
      const avg = (fn) => m.reduce((a, r) => a + fn(r), 0) / m.length;
      return {
        team: t,
        players: m.length,
        skill: avg((r) => r.skill),
        fitness: avg((r) => r.f[FIT]),
        availability: avg((r) => r.f[AVAIL]),
        positions: POSITIONS.map((p) => m.filter((r) => r.pos === p).length),
        clusters: Array.from({ length: k }, (_, c) => m.filter((r) => r.cluster === c).length),
      };
    });
  }

  const skillGap = (summary) => {
    const s = summary.map((t) => t.skill);
    return Math.max(...s) - Math.min(...s);
  };

  // random_team_baseline: mean skill gap over random splits of the same roster.
  function randomBaseline(players, nTeams, trials = 500, seed = 42) {
    let state = seed >>> 0;
    const rand = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const skills = players.map((p) => overallSkill(p.f));
    const base = players.map((_, i) => i % nTeams);
    let total = 0;
    for (let trial = 0; trial < trials; trial++) {
      const perm = base.slice();
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      const sums = new Array(nTeams).fill(0), counts = new Array(nTeams).fill(0);
      perm.forEach((t, i) => { sums[t] += skills[i]; counts[t] += 1; });
      const means = sums.map((s, t) => s / counts[t]);
      total += Math.max(...means) - Math.min(...means);
    }
    return total / trials;
  }

  // Nearest centroid plus assignment_margin: (d2 - d1) / d2.
  function placePlayer(features, data, k) {
    const x = features.map((v, j) => (v - data.mean[j]) / data.scale[j]);
    const d = data.k[k].centroids
      .map((c, i) => ({ i, d: Math.sqrt(c.reduce((a, cj, j) => a + (x[j] - cj) ** 2, 0)) }))
      .sort((a, b) => a.d - b.d);
    const margin = d.length > 1 && d[1].d > 0 ? (d[1].d - d[0].d) / d[1].d : 1;
    return { cluster: d[0].i, runnerUp: d.length > 1 ? d[1].i : null, margin, uncertain: margin < UNCERTAIN_MARGIN };
  }

  // suggest_team: fewest of that group, then of that position, then fewest players, then weakest.
  function suggestTeam(summary, cluster, pos) {
    const pi = POSITIONS.indexOf(pos);
    return summary
      .slice()
      .sort((a, b) =>
        a.clusters[cluster] - b.clusters[cluster] ||
        a.positions[pi] - b.positions[pi] ||
        a.players - b.players ||
        a.skill - b.skill ||
        a.team - b.team
      )[0].team;
  }

  const api = { POSITIONS, maxTeams, overallSkill, buildTeams, teamSummary, skillGap, randomBaseline, placePlayer, suggestTeam, UNCERTAIN_MARGIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TeamBalancer = api;
})(typeof window !== 'undefined' ? window : globalThis);
