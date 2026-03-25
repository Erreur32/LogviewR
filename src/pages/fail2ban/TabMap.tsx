/**
 * TabMap — Carte Leaflet des IPs bannies avec clustering et géolocalisation progressive.
 * Leaflet + MarkerCluster chargés via CDN (identique à la version PHP de référence).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../../api/client';
import { card, cardH } from './helpers';
import { Map as MapIcon, SlidersHorizontal } from 'lucide-react';

// ── CDN URLs (mêmes versions que la version PHP) ──────────────────────────────
const CDN = {
    leafletCss:       'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    clusterCss:       'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
    clusterDefaultCss:'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
    leafletJs:        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    clusterJs:        'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface GeoData { lat: number; lng: number; country: string; countryCode: string; region: string; city: string; org: string }
interface MapPoint { ip: string; jails: string[]; cached: GeoData | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Unicode flag emoji from ISO country code */
function countryFlag(code: string): string {
    const c = (code || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (c.length !== 2) return '🌐';
    return String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65) +
           String.fromCodePoint(0x1F1E6 + c.charCodeAt(1) - 65);
}

/** HSL heat colour — same algorithm as PHP reference */
function heatColor(n: number, min: number, max: number): string {
    const t = max <= min ? 1 : Math.max(0, Math.min(1, (n - min) / (max - min)));
    const hue   = 14 + t * 12;
    const sat   = Math.round(36 + t * 56);
    const light = Math.round(76 - t * 42);
    return `hsl(${hue.toFixed(1)},${sat}%,${light}%)`;
}

function loadLink(href: string): HTMLLinkElement {
    const existing = document.querySelector<HTMLLinkElement>(`link[href="${href}"]`);
    if (existing) return existing;
    const el = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
    document.head.appendChild(el);
    return el;
}

function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
        if (existing) {
            // Script tag already in DOM — wait for it if still loading, resolve if already done
            if ((existing as any)._loaded) { resolve(); return; }
            existing.addEventListener('load',  () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            return;
        }
        const s = document.createElement('script');
        s.src = src;
        s.onload  = () => { (s as any)._loaded = true; resolve(); };
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
    });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TabMapProps {
    onGoToTracker?: (ip: string) => void;
}

export const TabMap: React.FC<TabMapProps> = ({ onGoToTracker }) => {
    const mapContainerRef  = useRef<HTMLDivElement>(null);
    const mapRef           = useRef<any>(null);       // Leaflet map instance
    const clusterRef       = useRef<any>(null);       // MarkerCluster layer
    const markerByIp       = useRef<Map<string, any>>(new Map());
    const metaByIp         = useRef<Map<string, { country: string; countryCode: string; region: string; jails: string[] }>>(new Map());
    const onGoToTrackerRef = useRef(onGoToTracker);
    const pumpActiveRef    = useRef(false);
    onGoToTrackerRef.current = onGoToTracker;

    const [leafletReady, setLeafletReady] = useState(false);
    const [points, setPoints]             = useState<MapPoint[]>([]);
    const [loading, setLoading]           = useState(true);
    const [error, setError]               = useState<string | null>(null);
    const [resolved, setResolved]         = useState(0);
    const [asideOpen, setAsideOpen]       = useState(true);
    const [filterCountry, setFilterCountry] = useState('');
    const [filterRegion, setFilterRegion]   = useState('');
    const [countryStats, setCountryStats]   = useState<Record<string, number>>({});
    const [regionStats, setRegionStats]     = useState<Record<string, number>>({});
    const [resolveDelayMs, setResolveDelayMs] = useState(380);
    const [lastLoaded, setLastLoaded]         = useState<number>(0);

    // ── Load CDN ───────────────────────────────────────────────────────────────
    useEffect(() => {
        loadLink(CDN.leafletCss);
        loadLink(CDN.clusterCss);
        loadLink(CDN.clusterDefaultCss);
        loadScript(CDN.leafletJs)
            .then(() => loadScript(CDN.clusterJs))
            .then(() => setLeafletReady(true))
            .catch(e => setError(`Impossible de charger Leaflet : ${e.message}`));
    }, []);

    // ── Fetch map data ─────────────────────────────────────────────────────────
    const fetchMap = useCallback(() => {
        setLoading(true);
        api.get<{ ok: boolean; points: MapPoint[]; resolveDelayMs?: number; error?: string }>('/api/plugins/fail2ban/map')
            .then(res => {
                if (res.success && res.result?.ok) {
                    setPoints(res.result.points);
                    if (res.result.resolveDelayMs) setResolveDelayMs(Math.max(120, Math.min(2000, res.result.resolveDelayMs)));
                } else {
                    setError(res.result?.error ?? 'Erreur chargement carte');
                }
                setLoading(false);
                setLastLoaded(Date.now());
            });
    }, []);

    useEffect(() => { fetchMap(); }, [fetchMap]);

    // ── Build country/region stats from current markers ────────────────────────
    const rebuildStats = useCallback(() => {
        const cStats: Record<string, number> = {};
        const rStats: Record<string, number> = {};
        for (const [, meta] of metaByIp.current) {
            const c = meta.country || '??';
            cStats[c] = (cStats[c] ?? 0) + 1;
            if (filterCountry && meta.country === filterCountry) {
                const r = meta.region || '—';
                rStats[r] = (rStats[r] ?? 0) + 1;
            }
        }
        setCountryStats(cStats);
        setRegionStats(rStats);
    }, [filterCountry]);

    // ── Apply filter to cluster ────────────────────────────────────────────────
    const applyFilter = useCallback((country: string, region: string) => {
        if (!clusterRef.current) return;
        clusterRef.current.clearLayers();
        for (const [ip, marker] of markerByIp.current) {
            const meta = metaByIp.current.get(ip);
            if (!meta) continue;
            if (country && meta.country !== country) continue;
            if (region && (meta.region || '—') !== region) continue;
            clusterRef.current.addLayer(marker);
        }
    }, []);

    // ── Add a marker for an IP once geo is known ───────────────────────────────
    const addMarker = useCallback((point: MapPoint, geo: GeoData) => {
        if (!mapRef.current || markerByIp.current.has(point.ip)) return;
        const L = (window as any).L;
        const marker = L.marker([geo.lat, geo.lng], { title: point.ip });
        const loc = [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || '—';
        const jailBadges = point.jails.map(j =>
            `<span style="display:inline-block;padding:.1rem .35rem;border-radius:3px;font-size:.65rem;background:rgba(63,185,80,.15);color:#3fb950;border:1px solid rgba(63,185,80,.25);margin:.1rem">${j}</span>`
        ).join(' ');
        const popupHtml = `
            <div style="min-width:220px;font-family:system-ui,sans-serif">
                <div style="font-family:monospace;font-weight:700;color:#e86a65;font-size:.9rem;margin-bottom:.35rem">${point.ip}</div>
                <div style="font-size:.78rem;color:#e6edf3;margin-bottom:.25rem">${countryFlag(geo.countryCode)} ${loc}</div>
                ${geo.org ? `<div style="font-size:.72rem;color:#8b949e;margin-bottom:.35rem">${geo.org}</div>` : ''}
                <div style="margin-bottom:.5rem">${jailBadges}</div>
                <button class="f2b-map-tracker-btn" data-ip="${point.ip}"
                    style="width:100%;padding:.3rem .5rem;font-size:.75rem;border-radius:4px;background:rgba(88,166,255,.15);border:1px solid rgba(88,166,255,.3);color:#58a6ff;cursor:pointer;font-weight:600">
                    🔍 Détails dans le Tracker
                </button>
            </div>`;
        marker.bindPopup(popupHtml, { maxWidth: 280, className: 'f2b-map-popup' });
        marker.on('popupopen', () => {
            const el = marker.getPopup()?.getElement();
            if (!el) return;
            const btn = (el as Element).querySelector('.f2b-map-tracker-btn') as HTMLButtonElement | null;
            if (btn) btn.onclick = () => onGoToTrackerRef.current?.(point.ip);
        });
        marker.f2bCountry = geo.country || '';
        marker.f2bRegion  = geo.region  || '—';
        metaByIp.current.set(point.ip, { country: geo.country, countryCode: geo.countryCode, region: geo.region, jails: point.jails });
        markerByIp.current.set(point.ip, marker);
    }, []);

    // ── Init map + add cached markers ──────────────────────────────────────────
    useEffect(() => {
        if (!leafletReady || !points.length || !mapContainerRef.current) return;
        if (mapRef.current) return; // already initialized

        const L = (window as any).L;
        const map = L.map(mapContainerRef.current, { zoomControl: true }).setView([26, 12], 3);
        mapRef.current = map;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
            subdomains: 'abcd', maxZoom: 20,
        }).addTo(map);

        const cluster = L.markerClusterGroup({ chunkedLoading: true, spiderfyOnMaxZoom: true, showCoverageOnHover: false });
        clusterRef.current = cluster;
        map.addLayer(cluster);

        // Add cached markers immediately
        let done = 0;
        for (const p of points) {
            if (p.cached) { addMarker(p, p.cached); done++; }
        }
        setResolved(done);
        applyFilter('', '');
        rebuildStats();

        // Fix size after render
        requestAnimationFrame(() => { map.invalidateSize({ animate: false }); });
        setTimeout(() => map.invalidateSize({ animate: false }), 400);

        // Resize observer
        const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
        if (mapContainerRef.current) ro.observe(mapContainerRef.current);
        return () => { ro.disconnect(); };
    }, [leafletReady, points, addMarker, applyFilter, rebuildStats]);

    // ── Invalidate size when side panel toggles ────────────────────────────────
    useEffect(() => {
        if (!mapRef.current) return;
        setTimeout(() => mapRef.current?.invalidateSize({ animate: false }), 280);
    }, [asideOpen]);

    // ── Progressive geo resolution pump ───────────────────────────────────────
    useEffect(() => {
        if (!leafletReady || !mapRef.current || pumpActiveRef.current) return;
        const queue = points.filter(p => !p.cached).map(p => p.ip);
        if (!queue.length) return;
        pumpActiveRef.current = true;
        let idx = 0;

        function pump() {
            if (idx >= queue.length) { pumpActiveRef.current = false; return; }
            const ip = queue[idx++];
            api.get<{ ok: boolean; lat?: number; lng?: number; country?: string; countryCode?: string; region?: string; city?: string; org?: string }>(
                `/api/plugins/fail2ban/map/resolve/${encodeURIComponent(ip)}`
            ).then(res => {
                if (res.success && res.result?.ok && typeof res.result.lat === 'number') {
                    const geo: GeoData = {
                        lat: res.result.lat!, lng: res.result.lng!,
                        country: res.result.country ?? '', countryCode: res.result.countryCode ?? '',
                        region: res.result.region ?? '', city: res.result.city ?? '', org: res.result.org ?? '',
                    };
                    const point = points.find(p => p.ip === ip);
                    if (point) {
                        addMarker(point, geo);
                        setResolved(r => r + 1);
                        applyFilter(filterCountry, filterRegion);
                        rebuildStats();
                    }
                }
            }).finally(() => { setTimeout(pump, resolveDelayMs); });
        }
        pump();
    }, [leafletReady, points, resolveDelayMs, addMarker, applyFilter, rebuildStats, filterCountry, filterRegion]);

    // ── Filter handlers ────────────────────────────────────────────────────────
    const handleCountryClick = useCallback((code: string) => {
        const next = filterCountry === code ? '' : code;
        setFilterCountry(next);
        setFilterRegion('');
        applyFilter(next, '');
        rebuildStats();
        if (next && mapRef.current) {
            const L = (window as any).L;
            const bounds = L.latLngBounds([]);
            for (const [ip, marker] of markerByIp.current) {
                const meta = metaByIp.current.get(ip);
                if (meta?.country === next) bounds.extend(marker.getLatLng());
            }
            if (bounds.isValid()) mapRef.current.fitBounds(bounds.pad(0.12));
        }
    }, [filterCountry, applyFilter, rebuildStats]);

    const handleRegionClick = useCallback((region: string) => {
        const next = filterRegion === region ? '' : region;
        setFilterRegion(next);
        applyFilter(filterCountry, next);
    }, [filterRegion, filterCountry, applyFilter]);

    const handleReset = useCallback(() => {
        setFilterCountry('');
        setFilterRegion('');
        applyFilter('', '');
        rebuildStats();
        mapRef.current?.setView([26, 12], 3);
    }, [applyFilter, rebuildStats]);

    // ── Render ─────────────────────────────────────────────────────────────────

    if (error) return <div style={{ padding: '2rem', color: '#e86a65', fontSize: '.85rem' }}>{error}</div>;

    const total = points.length;
    const countryCodes = Object.keys(countryStats).sort((a, b) => countryStats[b] - countryStats[a]);
    const cVals = Object.values(countryStats);
    const minC = Math.min(...cVals, 0); const maxC = Math.max(...cVals, 1);
    const regionCodes = Object.keys(regionStats).sort((a, b) => regionStats[b] - regionStats[a]);
    const rVals = Object.values(regionStats);
    const minR = Math.min(...rVals, 0); const maxR = Math.max(...rVals, 1);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', height: 'calc(100vh - 165px)' }}>

            {/* Top bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexShrink: 0 }}>
                <MapIcon style={{ width: 15, height: 15, color: '#58a6ff' }} />
                <span style={{ fontWeight: 600, fontSize: '.88rem', color: '#58a6ff' }}>
                    {loading ? 'Chargement…' : `${total} IP${total > 1 ? 's' : ''} sur la carte`}
                </span>
                {!loading && total > 0 && (
                    <span style={{ fontSize: '.72rem', color: '#8b949e' }}>
                        {resolved} / {total} géolocalisée{total > 1 ? 's' : ''} · Cache SQLite ~30 j · ip-api.com
                    </span>
                )}
                {lastLoaded > 0 && !loading && (
                    <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: '#8b949e', whiteSpace: 'nowrap' }}>
                        ↻ {new Date(lastLoaded).toLocaleTimeString('fr-FR')}
                    </span>
                )}
            </div>

            {/* Empty state */}
            {!loading && total === 0 && (
                <div style={{ ...card, padding: '3rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>🌐</div>
                    <p style={{ color: '#3fb950', fontWeight: 700, fontSize: '1rem', marginBottom: '.4rem' }}>Aucune IP à afficher</p>
                    <p style={{ color: '#8b949e', fontSize: '.82rem' }}>La carte liste les IPs actuellement bannies (même source que le Tracker).</p>
                </div>
            )}

            {/* Map layout */}
            {(loading || total > 0) && (
                <div style={{ ...card, flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

                    {/* Map canvas */}
                    <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                        <div ref={mapContainerRef} style={{ width: '100%', height: '100%', background: '#0d1117' }} />
                        {loading && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,17,23,.7)', fontSize: '.85rem', color: '#8b949e', zIndex: 500 }}>
                                Chargement…
                            </div>
                        )}
                        {/* Toggle aside FAB */}
                        <button onClick={() => setAsideOpen(o => !o)} title="Afficher / masquer le panneau"
                            style={{ position: 'absolute', top: '.6rem', right: '.6rem', zIndex: 1000, width: 32, height: 32, borderRadius: 6, background: '#21262d', border: '1px solid #30363d', color: '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <SlidersHorizontal style={{ width: 14, height: 14 }} />
                        </button>
                    </div>

                    {/* Side panel */}
                    {asideOpen && (
                        <aside style={{ width: 240, flexShrink: 0, borderLeft: '1px solid #30363d', display: 'flex', flexDirection: 'column', overflowY: 'auto', background: '#161b22' }}>
                            <div style={{ ...cardH, borderBottom: '1px solid #30363d' }}>
                                <SlidersHorizontal style={{ width: 13, height: 13, color: '#39c5cf' }} />
                                <span style={{ fontWeight: 600, fontSize: '.82rem' }}>Contrôle &amp; filtres</span>
                            </div>

                            {/* Country section */}
                            <div style={{ borderBottom: '1px solid #30363d' }}>
                                <div style={{ padding: '.5rem .75rem .35rem', fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8b949e', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                                    <span style={{ fontSize: '.85rem' }}>🌍</span> Répartition par pays
                                </div>
                                <div style={{ padding: '0 .5rem .5rem' }}>
                                    {countryCodes.length === 0
                                        ? <span style={{ padding: '.25rem .25rem', fontSize: '.75rem', color: '#8b949e', display: 'block' }}>En attente de données…</span>
                                        : countryCodes.map(code => {
                                            const cnt = countryStats[code];
                                            const active = filterCountry === code;
                                            return (
                                                <button key={code} onClick={() => handleCountryClick(code)}
                                                    style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '.28rem .4rem', borderRadius: 4, border: `1px solid ${active ? 'rgba(88,166,255,.35)' : 'transparent'}`, background: active ? 'rgba(88,166,255,.1)' : 'transparent', cursor: 'pointer', marginBottom: '.15rem', gap: '.35rem' }}>
                                                    <span style={{ fontSize: '.82rem', flexShrink: 0 }}>{countryFlag(code)}</span>
                                                    <span style={{ fontSize: '.73rem', color: active ? '#58a6ff' : '#e6edf3', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{code === '??' ? '(inconnu)' : code}</span>
                                                    <span style={{ fontSize: '.72rem', fontWeight: 700, color: heatColor(cnt, minC, maxC), flexShrink: 0 }}>{cnt}</span>
                                                </button>
                                            );
                                        })
                                    }
                                    {countryCodes.length > 0 && (
                                        <button onClick={handleReset} style={{ width: '100%', marginTop: '.25rem', padding: '.25rem', fontSize: '.72rem', borderRadius: 4, background: 'transparent', border: '1px solid #30363d', color: '#8b949e', cursor: 'pointer' }}>
                                            Réinitialiser les filtres
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Region section */}
                            {filterCountry && (
                                <div style={{ borderBottom: '1px solid #30363d' }}>
                                    <div style={{ padding: '.5rem .75rem .35rem', fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8b949e', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                                        <span style={{ fontSize: '.85rem' }}>🗺️</span> Détail par région
                                    </div>
                                    <div style={{ padding: '0 .5rem .5rem' }}>
                                        {regionCodes.length === 0
                                            ? <span style={{ padding: '.25rem', fontSize: '.75rem', color: '#8b949e', display: 'block' }}>Aucune région connue</span>
                                            : regionCodes.map(r => {
                                                const cnt = regionStats[r];
                                                const active = filterRegion === r;
                                                return (
                                                    <button key={r} onClick={() => handleRegionClick(r)}
                                                        style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '.28rem .4rem', borderRadius: 4, border: `1px solid ${active ? 'rgba(188,140,255,.35)' : 'transparent'}`, background: active ? 'rgba(188,140,255,.08)' : 'transparent', cursor: 'pointer', marginBottom: '.15rem', gap: '.35rem' }}>
                                                        <span style={{ fontSize: '.73rem', color: active ? '#bc8cff' : '#e6edf3', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                                                        <span style={{ fontSize: '.72rem', fontWeight: 700, color: heatColor(cnt, minR, maxR), flexShrink: 0 }}>{cnt}</span>
                                                    </button>
                                                );
                                            })
                                        }
                                    </div>
                                </div>
                            )}

                            {/* Help */}
                            <div style={{ padding: '.65rem .75rem' }}>
                                <div style={{ fontSize: '.7rem', color: '#8b949e', lineHeight: 1.5 }}>
                                    <strong style={{ color: '#e6edf3' }}>Marqueur</strong> : popup → Détails pour ouvrir le Tracker.<br/>
                                    <strong style={{ color: '#e6edf3' }}>Pays</strong> : zoom sur l'emprise + masque les autres points.<br/>
                                    IPs sans coordonnées résolues progressivement (limite la charge sur ip-api.com).
                                </div>
                            </div>
                        </aside>
                    )}
                </div>
            )}
        </div>
    );
};
