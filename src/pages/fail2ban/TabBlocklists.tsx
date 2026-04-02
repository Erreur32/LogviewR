/**
 * TabBlocklists — gestionnaire de blocklists IP (Data-Shield).
 */

import React, { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';
import { api } from '../../api/client';

// ── Types ──────────────────────────────────────────────────────────────────────

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

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    setLists(prev => prev.map(l => l.id === id ? { ...l, updating: true } : l));
    try {
      await api.post<{ ok: boolean; error?: string }>(
        '/api/plugins/fail2ban/blocklists/toggle',
        { id, enabled: !currentEnabled }
      );
    } finally {
      await fetchStatus();
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
        { name: newName, url: newUrl, ipsetName: newIpset, description: newDesc }
      );
      if (res.result?.ok) {
        setShowAddForm(false);
        setNewName(''); setNewUrl(''); setNewIpset(''); setNewDesc('');
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
      await api.delete<{ ok: boolean }>(`/api/plugins/fail2ban/blocklists/remove/${id}`);
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

      {/* ── List cards ── */}
      {!loading && lists.map(list => (
        <div key={list.id} style={{
          background: '#161b22',
          border: '1px solid rgba(48,54,61,1)',
          borderLeft: `4px solid ${list.builtin ? '#e86a65' : '#58a6ff'}`,
          borderRadius: 6,
          padding: '1rem',
          marginBottom: '.75rem',
        }}>
          {/* Card header: name + toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}>
              <Shield style={{ width: 16, height: 16, color: '#e86a65', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: '.95rem', color: '#e6edf3' }}>{list.name}</span>
            </div>
            <button
              onClick={() => !list.updating && handleToggle(list.id, list.enabled)}
              disabled={list.updating}
              style={{
                background: list.enabled ? 'rgba(63,185,80,.15)' : 'rgba(139,148,158,.1)',
                border: `1px solid ${list.enabled ? '#3fb950' : '#555d69'}`,
                color: list.enabled ? '#3fb950' : '#8b949e',
                borderRadius: 20, padding: '.2rem .75rem',
                fontSize: '.75rem', fontWeight: 600, cursor: list.updating ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '.3rem',
                opacity: list.updating ? 0.6 : 1,
              }}
            >
              {list.updating ? '...' : (list.enabled ? '● ACTIF' : '○ INACTIF')}
            </button>
            {!list.builtin && (
              <button
                onClick={() => handleRemove(list.id)}
                disabled={list.updating}
                title="Supprimer cette liste"
                style={{
                  background: 'rgba(248,81,73,.1)',
                  border: '1px solid rgba(248,81,73,.3)',
                  color: '#f85149',
                  borderRadius: 4,
                  padding: '.2rem .5rem',
                  fontSize: '.75rem',
                  cursor: 'pointer',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Description */}
          <div style={{ fontSize: '.82rem', color: '#8b949e', marginTop: '.3rem' }}>
            {list.description}
          </div>

          {/* Separator */}
          <div style={{ borderTop: '1px solid rgba(48,54,61,.6)', margin: '.6rem 0' }} />

          {/* Stats row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.4rem' }}>
            <span style={{ color: '#bc8cff', fontWeight: 600 }}>
              {list.count.toLocaleString()}
            </span>
            <span style={{ color: '#8b949e', fontSize: '.82rem' }}>IPs</span>
            <span style={{ color: '#555d69', fontSize: '.8rem' }}>•</span>
            <span style={{ color: '#8b949e', fontSize: '.8rem' }}>Mis à jour {fmtAge(list.lastUpdate)}</span>
          </div>

          {/* Source badge */}
          <div style={{ marginBottom: '.65rem' }}>
            <span style={{
              display: 'inline-block',
              background: 'rgba(139,148,158,.08)',
              border: '1px solid rgba(139,148,158,.2)',
              color: '#8b949e',
              borderRadius: 3,
              padding: '.07rem .45rem',
              fontSize: '.72rem',
            }}>
              Source : jsDelivr CDN
            </span>
          </div>

          {/* Refresh button */}
          <button
            onClick={() => !list.updating && handleRefresh(list.id)}
            disabled={list.updating}
            style={{
              background: 'rgba(88,166,255,.1)', border: '1px solid rgba(88,166,255,.3)',
              color: list.updating ? '#555d69' : '#58a6ff',
              borderRadius: 4, padding: '.3rem .75rem',
              fontSize: '.8rem', cursor: list.updating ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '.35rem',
            }}
          >
            {list.updating ? '⟳ En cours…' : '↻ Rafraîchir'}
          </button>

          {/* Error display */}
          {list.error && (
            <div style={{ color: '#f85149', fontSize: '.78rem', marginTop: '.4rem', padding: '.3rem .5rem', background: 'rgba(248,81,73,.1)', borderRadius: 4, border: '1px solid rgba(248,81,73,.2)' }}>
              ⚠ {list.error}
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
          <div style={{ marginBottom: '.75rem' }}>
            <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>Description</label>
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="Optionnel"
              style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: '.3rem .5rem', color: '#e6edf3', fontSize: '.85rem', boxSizing: 'border-box' }} />
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
              onClick={() => { setShowAddForm(false); setAddError(null); setNewName(''); setNewUrl(''); setNewIpset(''); setNewDesc(''); }}
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
          Trafic entrant (INPUT) uniquement — ne jamais activer sur le trafic sortant.
        </div>
      )}
    </div>
  );
};
