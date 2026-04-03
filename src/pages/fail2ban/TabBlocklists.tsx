/**
 * TabBlocklists — gestionnaire de blocklists IP (Data-Shield).
 */

import React, { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';
import { api } from '../../api/client';

// ── Types ──────────────────────────────────────────────────────────────────────

type ListDirection = 'in' | 'out' | 'both';

interface ListState {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  lastUpdate: string | null;
  count: number;
  error: string | null;
  updating: boolean;
  builtin: boolean;
  direction: ListDirection;
  sourceUrl?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtAge(iso: string | null): string {
  if (!iso) return 'Non chargée';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'il y a moins d\'1 min';
  if (mins < 60) return `il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  // More than 24h: truncated ISO
  return iso.slice(0, 16).replace('T', ' ');
}

// ── Main component ─────────────────────────────────────────────────────────────

export const TabBlocklists: React.FC = () => {
  const [lists, setLists] = useState<ListState[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newIpset, setNewIpset] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newMaxelem, setNewMaxelem] = useState(150_000);
  const [newDirection, setNewDirection] = useState<ListDirection>('in');
  const [selfBanConfirm, setSelfBanConfirm] = useState<{ id: string; ip: string; listName: string } | null>(null);
  const [forceToggling, setForceToggling] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await api.get<{ lists: ListState[] }>('/api/plugins/fail2ban/blocklists/status');
      if (res.success) {
        setLists(res.result?.lists ?? []);
      } else {
        setGlobalError('Impossible de charger le statut des blocklists.');
      }
    } catch {
      setGlobalError('Erreur réseau lors du chargement des blocklists.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = async (id: string, currentEnabled: boolean, force?: boolean) => {
    setLists(prev => prev.map(l => l.id === id ? { ...l, updating: true } : l));
    try {
      const res = await api.post<{ ok: boolean; selfBan?: boolean; error?: string }>(
        '/api/plugins/fail2ban/blocklists/toggle',
        { id, enabled: !currentEnabled, force }
      );
      if (res.result?.selfBan) {
        const match = res.result.error?.match(/\(([^)]+)\)/);
        const ip = match ? match[1] : '?';
        const listName = lists.find(l => l.id === id)?.name ?? id;
        setLists(prev => prev.map(l => l.id === id ? { ...l, updating: false } : l));
        setSelfBanConfirm({ id, ip, listName });
        return;
      }
      await fetchStatus();
    } catch {
      await fetchStatus();
    }
  };

  const handleForceConfirm = async () => {
    if (!selfBanConfirm) return;
    setForceToggling(true);
    try {
      await handleToggle(selfBanConfirm.id, false, true);
    } finally {
      setSelfBanConfirm(null);
      setForceToggling(false);
    }
  };

  const handleRefresh = async (id: string) => {
    setLists(prev => prev.map(l => l.id === id ? { ...l, updating: true } : l));
    try {
      await api.post<{ ok: boolean; count?: number; error?: string }>(
        '/api/plugins/fail2ban/blocklists/refresh',
        { id }
      );
    } finally {
      await fetchStatus();
    }
  };

  const handleForceReset = async (id: string) => {
    setLists(prev => prev.map(l => l.id === id ? { ...l, updating: true } : l));
    try {
      await api.post<{ ok: boolean; count?: number; error?: string }>(
        '/api/plugins/fail2ban/blocklists/force-reset',
        { id }
      );
    } finally {
      await fetchStatus();
    }
  };

  const handleAdd = async () => {
    if (lists.some(l => l.id === newIpset)) {
      setAddError(`Le nom d'ipset "${newIpset}" est déjà utilisé`);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await api.post<{ ok: boolean; error?: string }>(
        '/api/plugins/fail2ban/blocklists/add',
        { name: newName, url: newUrl, ipsetName: newIpset, description: newDesc, maxelem: newMaxelem, direction: newDirection }
      );
      if (res.result?.ok) {
        setShowAddForm(false);
        setNewName(''); setNewUrl(''); setNewIpset(''); setNewDesc(''); setNewMaxelem(150_000); setNewDirection('in');
        await fetchStatus();
      } else {
        setAddError(res.result?.error ?? 'Erreur inconnue');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      const res = await api.delete<{ ok: boolean; error?: string }>(`/api/plugins/fail2ban/blocklists/remove/${id}`);
      if (res.result && !res.result.ok) {
        setGlobalError(res.result.error ?? 'Erreur lors de la suppression');
      }
    } finally {
      await fetchStatus();
    }
  };

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.3rem' }}>
          <Shield style={{ width: 18, height: 18, color: '#e86a65' }} />
          <span style={{ fontWeight: 700, fontSize: '1rem', color: '#e6edf3' }}>Blocklists IP</span>
          <span style={{ fontSize: '.72rem', color: '#8b949e' }}>({lists.length} sources)</span>
        </div>
        <p style={{ color: '#8b949e', fontSize: '.82rem', margin: 0 }}>
          Listes IPv4 malveillantes chargées dans des ipsets avec règles iptables DROP sur INPUT.
        </p>
      </div>

      {/* ── Global error ── */}
      {globalError && (
        <div style={{ color: '#f85149', fontSize: '.82rem', padding: '.5rem .75rem', background: 'rgba(248,81,73,.08)', borderRadius: 4, marginBottom: '.75rem' }}>
          {globalError}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{ color: '#8b949e', fontSize: '.85rem', padding: '1rem 0' }}>Chargement…</div>
      )}

      {/* ── List rows — compact horizontal ── */}
      {!loading && lists.map(list => (
        <div key={list.id} style={{
          background: '#161b22',
          border: '1px solid rgba(48,54,61,.8)',
          borderLeft: `3px solid ${list.builtin ? '#e86a65' : '#58a6ff'}`,
          borderRadius: 5,
          padding: '.42rem .65rem',
          marginBottom: '.35rem',
          display: 'flex',
          alignItems: 'center',
          gap: '.55rem',
          flexWrap: 'wrap',
          opacity: list.updating ? 0.75 : 1,
          transition: 'opacity .15s',
        }}>
          {/* Toggle button */}
          <button
            onClick={() => !list.updating && handleToggle(list.id, list.enabled)}
            disabled={list.updating}
            title={list.enabled ? 'Désactiver' : 'Activer'}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: list.updating ? '#555d69' : list.enabled ? '#3fb950' : '#484f58',
              fontSize: '1rem', lineHeight: 1, cursor: list.updating ? 'default' : 'pointer',
              flexShrink: 0, width: 16, textAlign: 'center',
            }}
          >
            {list.updating ? '⟳' : list.enabled ? '●' : '○'}
          </button>

          {/* Name + description */}
          <div style={{ flex: '1 1 140px', minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '.83rem', color: '#e6edf3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {list.name}
            </div>
            <div style={{ fontSize: '.7rem', color: '#555d69', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {list.description}
            </div>
          </div>

          {/* IP count */}
          {list.count > 0 && (
            <span style={{ fontSize: '.75rem', color: '#bc8cff', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {list.count.toLocaleString()} IPs
            </span>
          )}

          {/* Age */}
          <span style={{ fontSize: '.7rem', color: '#484f58', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {fmtAge(list.lastUpdate)}
          </span>

          {/* Direction badge */}
          <span style={{
            fontSize: '.68rem', fontWeight: 600, borderRadius: 3, padding: '.05rem .35rem', flexShrink: 0,
            background: list.direction === 'out' ? 'rgba(227,179,65,.1)' : list.direction === 'both' ? 'rgba(188,140,255,.1)' : 'rgba(63,185,80,.07)',
            border: `1px solid ${list.direction === 'out' ? 'rgba(227,179,65,.3)' : list.direction === 'both' ? 'rgba(188,140,255,.3)' : 'rgba(63,185,80,.2)'}`,
            color: list.direction === 'out' ? '#e3b341' : list.direction === 'both' ? '#bc8cff' : '#3fb950',
          }}>
            {list.direction === 'in' ? '↓ IN' : list.direction === 'out' ? '↑ OUT' : '↕'}
          </span>

          {/* Source link */}
          {list.sourceUrl && (
            <a href={list.sourceUrl} target="_blank" rel="noopener noreferrer"
              title="Voir la source"
              style={{ fontSize: '.7rem', color: '#58a6ff', textDecoration: 'none', flexShrink: 0 }}>
              ↗
            </a>
          )}

          {/* Out warning when active */}
          {(list.direction === 'out' || list.direction === 'both') && list.enabled && (
            <span style={{ fontSize: '.68rem', color: '#e3b341', flexShrink: 0 }} title="Filtre le trafic sortant">⚠</span>
          )}

          {/* Spacer */}
          <div style={{ flex: '0 0 0' }} />

          {/* Refresh button */}
          <button
            onClick={() => !list.updating && handleRefresh(list.id)}
            disabled={list.updating}
            title="Rafraîchir la liste"
            style={{
              background: 'rgba(88,166,255,.08)', border: '1px solid rgba(88,166,255,.2)',
              color: list.updating ? '#555d69' : '#58a6ff',
              borderRadius: 4, padding: '.2rem .5rem',
              fontSize: '.72rem', cursor: list.updating ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '.25rem', flexShrink: 0,
            }}
          >
            ↻{list.updating ? ' …' : ''}
          </button>

          {/* Delete button (custom lists only) */}
          {!list.builtin && (
            <button
              onClick={() => handleRemove(list.id)}
              disabled={list.updating}
              title="Supprimer cette liste"
              style={{
                background: 'rgba(248,81,73,.08)', border: '1px solid rgba(248,81,73,.2)',
                color: '#f85149', borderRadius: 4, padding: '.2rem .4rem',
                fontSize: '.72rem', cursor: list.updating ? 'default' : 'pointer',
                flexShrink: 0, lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}

          {/* Error inline + Force reset button */}
          {list.error && (
            <div style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: '.5rem', marginTop: '.1rem' }}>
              <div style={{ flex: 1, color: '#f85149', fontSize: '.72rem', padding: '.2rem .4rem', background: 'rgba(248,81,73,.07)', borderRadius: 3, border: '1px solid rgba(248,81,73,.15)' }}>
                ⚠ {list.error}
              </div>
              <button
                onClick={() => !list.updating && handleForceReset(list.id)}
                disabled={list.updating}
                title="Détruire l'ipset existant et recharger depuis zéro"
                style={{
                  flexShrink: 0, background: 'rgba(248,81,73,.12)', border: '1px solid rgba(248,81,73,.35)',
                  color: list.updating ? '#555d69' : '#f85149', borderRadius: 4, padding: '.2rem .5rem',
                  fontSize: '.72rem', cursor: list.updating ? 'default' : 'pointer', whiteSpace: 'nowrap',
                }}
              >
                🔄 Reset ipset
              </button>
            </div>
          )}
        </div>
      ))}

      {/* ── Add custom list ── */}
      {!loading && (!showAddForm ? (
        <button
          onClick={() => setShowAddForm(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '.4rem',
            background: 'rgba(88,166,255,.08)', border: '1px dashed rgba(88,166,255,.3)',
            color: '#58a6ff', borderRadius: 6, padding: '.5rem 1rem',
            fontSize: '.82rem', cursor: 'pointer', width: '100%', justifyContent: 'center',
            marginBottom: '.75rem',
          }}
        >
          + Ajouter une liste
        </button>
      ) : (
        <div style={{
          background: '#161b22', border: '1px solid rgba(88,166,255,.3)',
          borderLeft: '4px solid #58a6ff', borderRadius: 6,
          padding: '1rem', marginBottom: '.75rem',
        }}>
          <div style={{ fontWeight: 600, color: '#e6edf3', marginBottom: '.75rem', fontSize: '.9rem' }}>
            Nouvelle liste personnalisée
          </div>

          {/* Name */}
          <div style={{ marginBottom: '.5rem' }}>
            <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>Nom *</label>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Ex: Spamhaus DROP"
              style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: '.3rem .5rem', color: '#e6edf3', fontSize: '.85rem', boxSizing: 'border-box' }} />
          </div>

          {/* URL */}
          <div style={{ marginBottom: '.5rem' }}>
            <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>URL *</label>
            <input value={newUrl} onChange={e => setNewUrl(e.target.value)}
              placeholder="https://..."
              style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: '.3rem .5rem', color: '#e6edf3', fontSize: '.85rem', boxSizing: 'border-box' }} />
          </div>

          {/* ipset name */}
          <div style={{ marginBottom: '.5rem' }}>
            <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>Nom d'ipset * <span style={{ color: '#555d69' }}>(lettres minuscules, chiffres, tirets)</span></label>
            <input value={newIpset} onChange={e => { setNewIpset(e.target.value); setAddError(null); }}
              placeholder="Ex: spamhaus-drop"
              style={{
                width: '100%', background: '#0d1117',
                border: `1px solid ${lists.some(l => l.id === newIpset) && newIpset ? '#f85149' : '#30363d'}`,
                borderRadius: 4, padding: '.3rem .5rem', color: '#e6edf3', fontSize: '.85rem', boxSizing: 'border-box',
              }} />
            {lists.some(l => l.id === newIpset) && newIpset && (
              <div style={{ color: '#f85149', fontSize: '.75rem', marginTop: '.2rem' }}>Nom déjà utilisé</div>
            )}
          </div>

          {/* Description */}
          <div style={{ marginBottom: '.5rem' }}>
            <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>Description</label>
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="Optionnel"
              style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: '.3rem .5rem', color: '#e6edf3', fontSize: '.85rem', boxSizing: 'border-box' }} />
          </div>

          {/* Maxelem */}
          <div style={{ marginBottom: '.75rem' }}>
            <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>
              Taille max ipset <span style={{ color: '#555d69' }}>(maxelem — nb max d'IPs)</span>
            </label>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {[65_000, 150_000, 500_000, 1_000_000].map(v => (
                <button key={v} type="button" onClick={() => setNewMaxelem(v)}
                  style={{
                    padding: '.2rem .55rem', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer',
                    background: newMaxelem === v ? 'rgba(88,166,255,.2)' : 'rgba(139,148,158,.08)',
                    border: `1px solid ${newMaxelem === v ? 'rgba(88,166,255,.5)' : '#30363d'}`,
                    color: newMaxelem === v ? '#58a6ff' : '#8b949e',
                  }}>
                  {v >= 1_000_000 ? `${v / 1_000_000}M` : `${v / 1_000}K`}
                </button>
              ))}
              <input
                type="number" min={1000} max={5_000_000} step={1000}
                value={newMaxelem}
                onChange={e => setNewMaxelem(Math.max(1000, parseInt(e.target.value) || 150_000))}
                style={{ width: 110, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: '.2rem .5rem', color: '#e6edf3', fontSize: '.82rem' }}
              />
            </div>
            {newMaxelem >= 500_000 && (
              <div style={{ color: '#e3b341', fontSize: '.72rem', marginTop: '.25rem' }}>
                ⚠ Les grands ipsets consomment plus de RAM kernel. 500K ≈ 14 MB, 1M ≈ 28 MB.
              </div>
            )}
          </div>

          {/* Direction */}
          <div style={{ marginBottom: '.75rem' }}>
            <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>Direction iptables</label>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              {(['in', 'out', 'both'] as ListDirection[]).map(d => (
                <button key={d} type="button" onClick={() => setNewDirection(d)}
                  style={{
                    padding: '.2rem .7rem', borderRadius: 4, fontSize: '.78rem', cursor: 'pointer',
                    background: newDirection === d ? (d === 'out' ? 'rgba(227,179,65,.2)' : d === 'both' ? 'rgba(188,140,255,.2)' : 'rgba(63,185,80,.12)') : 'rgba(139,148,158,.08)',
                    border: `1px solid ${newDirection === d ? (d === 'out' ? 'rgba(227,179,65,.5)' : d === 'both' ? 'rgba(188,140,255,.5)' : 'rgba(63,185,80,.4)') : '#30363d'}`,
                    color: newDirection === d ? (d === 'out' ? '#e3b341' : d === 'both' ? '#bc8cff' : '#3fb950') : '#8b949e',
                    fontWeight: newDirection === d ? 600 : 400,
                  }}>
                  {d === 'in' ? '↓ INPUT' : d === 'out' ? '↑ OUTPUT' : '↕ IN+OUT'}
                </button>
              ))}
            </div>
            {newDirection !== 'in' && (
              <div style={{ color: '#e3b341', fontSize: '.72rem', marginTop: '.3rem', padding: '.3rem .5rem', background: 'rgba(227,179,65,.06)', border: '1px solid rgba(227,179,65,.2)', borderRadius: 4 }}>
                ⚠ <strong>Attention OUTPUT</strong> : bloque les connexions sortantes depuis ce serveur.
                Si la liste contient des IPs de CDN, DNS ou APIs systèmes, ça peut casser des services. Tester d'abord en environnement non critique.
              </div>
            )}
          </div>

          {addError && (
            <div style={{ color: '#f85149', fontSize: '.78rem', marginBottom: '.5rem', padding: '.3rem .5rem', background: 'rgba(248,81,73,.1)', borderRadius: 4, border: '1px solid rgba(248,81,73,.2)' }}>
              ⚠ {addError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim() || !newUrl.trim() || !newIpset.trim() || lists.some(l => l.id === newIpset)}
              style={{
                background: 'rgba(88,166,255,.15)', border: '1px solid rgba(88,166,255,.4)',
                color: '#58a6ff', borderRadius: 4, padding: '.3rem .85rem',
                fontSize: '.82rem', cursor: 'pointer', opacity: adding ? 0.6 : 1,
              }}
            >
              {adding ? 'Ajout…' : 'Ajouter'}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setAddError(null); setNewName(''); setNewUrl(''); setNewIpset(''); setNewDesc(''); setNewMaxelem(150_000); setNewDirection('in'); }}
              style={{
                background: 'transparent', border: '1px solid #30363d',
                color: '#8b949e', borderRadius: 4, padding: '.3rem .75rem',
                fontSize: '.82rem', cursor: 'pointer',
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      ))}

      {/* ── Info note ── */}
      {!loading && (
        <div style={{ marginTop: '1rem', padding: '.6rem .8rem', background: 'rgba(88,166,255,.06)', border: '1px solid rgba(88,166,255,.15)', borderRadius: 6, fontSize: '.78rem', color: '#8b949e', lineHeight: 1.5 }}>
          <span style={{ color: '#58a6ff', fontWeight: 600 }}>💡 Mise à jour automatique</span> : LogviewR rafraîchit les listes activées toutes les 6h.
          Les règles iptables sont recréées automatiquement si elles disparaissent au prochain rafraîchissement.
          Trafic entrant (INPUT) par défaut — les listes en mode sortant (OUTPUT) peuvent être activées, mais avec précaution : elles bloquent les connexions initiées depuis votre serveur.
        </div>
      )}

      {/* ── Self-ban warning modal ── */}
      {selfBanConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <div style={{
            background: '#161b22', border: '1px solid rgba(248,81,73,.4)',
            borderRadius: 8, padding: '1.5rem', maxWidth: 420, width: '90%',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.75rem' }}>
              <span style={{ fontSize: '1.2rem' }}>⚠️</span>
              <span style={{ fontWeight: 700, color: '#f85149', fontSize: '.95rem' }}>Risque d'auto-bannissement</span>
            </div>
            <p style={{ color: '#e6edf3', fontSize: '.85rem', margin: '0 0 .5rem' }}>
              Votre IP <strong style={{ color: '#ffa657' }}>{selfBanConfirm.ip}</strong> est présente dans la liste <strong style={{ color: '#e6edf3' }}>{selfBanConfirm.listName}</strong>.
            </p>
            <p style={{ color: '#8b949e', fontSize: '.82rem', margin: '0 0 1.25rem' }}>
              L'activer vous bannirait immédiatement de l'interface. Ajoutez votre IP en whitelist iptables avant de continuer, ou forcez si vous savez ce que vous faites.
            </p>
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setSelfBanConfirm(null)}
                style={{
                  background: 'rgba(139,148,158,.12)', border: '1px solid rgba(139,148,158,.3)',
                  color: '#e6edf3', borderRadius: 5, padding: '.35rem .85rem',
                  fontSize: '.82rem', cursor: 'pointer',
                }}
              >
                Annuler
              </button>
              <button
                onClick={handleForceConfirm}
                disabled={forceToggling}
                style={{
                  background: 'rgba(248,81,73,.15)', border: '1px solid rgba(248,81,73,.4)',
                  color: '#f85149', borderRadius: 5, padding: '.35rem .85rem',
                  fontSize: '.82rem', cursor: forceToggling ? 'default' : 'pointer',
                  opacity: forceToggling ? 0.6 : 1,
                }}
              >
                {forceToggling ? 'Activation…' : "Forcer l'activation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
