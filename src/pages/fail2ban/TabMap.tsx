/**
 * TabMap — Carte Leaflet des IPs bannies avec clustering et géolocalisation progressive.
 * Leaflet + MarkerCluster chargés localement (npm packages).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

// Fix Leaflet default marker icons broken by Vite's asset hashing
import iconUrl        from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl  from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl      from 'leaflet/dist/images/marker-shadow.png';
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { card, cardH, F2bTooltip } from './helpers';
import { Map as MapIcon, SlidersHorizontal } from 'lucide-react';
import { FlagImg } from './FlagImg';

// ── Types ─────────────────────────────────────────────────────────────────────
interface GeoData { lat: number; lng: number; country: string; countryCode: string; region: string; city: string; org: string }
interface MapPoint { ip: string; jails: string[]; cached: GeoData | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

const FLAG_BASE = '/icons/country';

/** Flag img tag — local SVG, for use in raw HTML strings */
function flagImgHtml(code: string): string {
    const c = (code || '').toLowerCase().replace(/[^a-z]/g, '');
    const src = c.length === 2 ? `${FLAG_BASE}/${c}.svg` : `${FLAG_BASE}/xx.svg`;
    const fallback = `${FLAG_BASE}/xx.svg`;
    return `<img src="${src}" width="20" height="15" style="vertical-align:middle;border-radius:2px;margin-right:.3rem" alt="${c.toUpperCase()}" onerror="this.src='${fallback}'">`;
}


/** HSL heat colour — same algorithm as PHP reference */
function heatColor(n: number, min: number, max: number): string {
    const t = max <= min ? 1 : Math.max(0, Math.min(1, (n - min) / (max - min)));
    const hue   = 14 + t * 12;
    const sat   = Math.round(36 + t * 56);
    const light = Math.round(76 - t * 42);
    return `hsl(${hue.toFixed(1)},${sat}%,${light}%)`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TabMapProps {
    onGoToTracker?: (ip: string) => void;
    onIpClick?:     (ip: string) => void;
    refreshKey?:    number;   // increment to trigger a map data refresh
}

export const TabMap: React.FC<TabMapProps> = ({ onGoToTracker, onIpClick, refreshKey }) => {
    const { t } = useTranslation();
    const mapContainerRef  = useRef<HTMLDivElement>(null);
    const mapRef           = useRef<any>(null);       // Leaflet map instance
    const clusterRef       = useRef<any>(null);       // MarkerCluster layer
    const markerByIp       = useRef<Map<string, any>>(new Map());
    const metaByIp         = useRef<Map<string, { country: string; countryCode: string; region: string; jails: string[] }>>(new Map());
    const onGoToTrackerRef = useRef(onGoToTracker);
    const onIpClickRef     = useRef(onIpClick);
    const pumpActiveRef    = useRef(false);
    onGoToTrackerRef.current = onGoToTracker;
    onIpClickRef.current     = onIpClick;

    const [mapReady, setMapReady]         = useState(false);
    const [points, setPoints]             = useState<MapPoint[]>([]);
    const [loading, setLoading]           = useState(true);
    const [error, setError]               = useState<string | null>(null);
    const [resolved, setResolved]         = useState(0);
    const [asideOpen, setAsideOpen]       = useState(true);
    const [filterCountry, setFilterCountry] = useState('');
    const [filterRegion, setFilterRegion]   = useState('');
    const [countryStats, setCountryStats]   = useState<Record<string, number>>({});
    const [countryCodeMap, setCountryCodeMap] = useState<Record<string, string>>({}); // countryName → ISO code
    const [regionStats, setRegionStats]     = useState<Record<string, number>>({});
    const [resolveDelayMs, setResolveDelayMs] = useState(380);
    const [mapSource, setMapSource]           = useState<'live' | 'history'>('live');

    // ── Inject dark popup CSS once ─────────────────────────────────────────────
    useEffect(() => {
        if (!document.getElementById('f2b-map-popup-style')) {
            const s = document.createElement('style');
            s.id = 'f2b-map-popup-style';
            s.textContent = `
                @keyframes f2b-spin { to { transform: rotate(360deg) translateZ(0); } }
                .f2b-geo-spin { animation: f2b-spin 1.2s linear infinite; transform-origin: 5.5px 5.5px; }
                .f2b-map-popup .leaflet-popup-content-wrapper {
                    background: #161b22; border: 1px solid #30363d;
                    border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,.6);
                    color: #e6edf3; padding: 0;
                }
                .f2b-map-popup .leaflet-popup-content { margin: 0; padding: .75rem .85rem; }
                .f2b-map-popup .leaflet-popup-tip { background: #30363d; }
                .f2b-map-popup .leaflet-popup-close-button { color: #8b949e !important; font-size: 16px; top: 6px !important; right: 8px !important; }
                .f2b-map-popup .leaflet-popup-close-button:hover { color: #e6edf3 !important; }
            `;
            document.head.appendChild(s);
        }
        setMapReady(true);
    }, []);

    // ── Fetch map data ─────────────────────────────────────────────────────────
    const fetchMap = useCallback((source: 'live' | 'history') => {
        setLoading(true);
        // Reset map state when switching source
        markerByIp.current.clear();
        metaByIp.current.clear();
        pumpActiveRef.current = false;
        if (clusterRef.current) clusterRef.current.clearLayers();
        setResolved(0);
        setCountryStats({});
        setCountryCodeMap({});
        setRegionStats({});
        setFilterCountry('');
        setFilterRegion('');
        api.get<{ ok: boolean; points: MapPoint[]; resolveDelayMs?: number; error?: string }>(`/api/plugins/fail2ban/map?source=${source}`)
            .then(res => {
                if (res.success && res.result?.ok) {
                    setPoints(res.result.points);
                    if (res.result.resolveDelayMs) setResolveDelayMs(Math.max(120, Math.min(2000, res.result.resolveDelayMs)));
                } else {
                    setError(res.result?.error ?? t('fail2ban.map.loading'));
                }
            })
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { fetchMap(mapSource); }, [mapSource]); // eslint-disable-line react-hooks/exhaustive-deps

    // Refresh map data when parent header refreshes (skip initial mount — mapSource effect handles that)
    const refreshKeyRef = useRef(refreshKey);
    useEffect(() => {
        if (refreshKey === refreshKeyRef.current) return; // skip initial
        refreshKeyRef.current = refreshKey;
        fetchMap(mapSource);
    }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Build country/region stats from current markers ────────────────────────
    const rebuildStats = useCallback(() => {
        const cStats: Record<string, number> = {};
        const cCodes: Record<string, string> = {}; // countryName → ISO code
        const rStats: Record<string, number> = {};
        for (const [, meta] of metaByIp.current) {
            const c = meta.country || '??';
            cStats[c] = (cStats[c] ?? 0) + 1;
            if (meta.countryCode) cCodes[c] = meta.countryCode;
            if (filterCountry && meta.country === filterCountry) {
                const r = meta.region || '—';
                rStats[r] = (rStats[r] ?? 0) + 1;
            }
        }
        setCountryStats(cStats);
        setCountryCodeMap(cCodes);
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
        
        const marker = L.marker([geo.lat, geo.lng], { title: point.ip });
        const loc = [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || '—';
        const jailBadges = point.jails.map(j =>
            `<span style="display:inline-block;padding:.1rem .35rem;border-radius:3px;font-size:.65rem;background:rgba(63,185,80,.15);color:#3fb950;border:1px solid rgba(63,185,80,.25);margin:.1rem">${j}</span>`
        ).join(' ');
        const popupHtml = `
            <div style="min-width:220px;font-family:system-ui,sans-serif">
                <div style="font-family:monospace;font-weight:700;color:#e86a65;font-size:.9rem;margin-bottom:.35rem">${point.ip}</div>
                <div style="font-size:.78rem;color:#e6edf3;margin-bottom:.25rem;display:flex;align-items:center;gap:.3rem">${flagImgHtml(geo.countryCode)}${loc}</div>
                ${geo.org ? `<div style="font-size:.72rem;color:#8b949e;margin-bottom:.35rem">${geo.org}</div>` : ''}
                <div style="margin-bottom:.5rem">${jailBadges}</div>
                <button class="f2b-map-ip-btn" data-ip="${point.ip}"
                    style="width:100%;padding:.3rem .5rem;font-size:.75rem;border-radius:4px;background:rgba(232,106,101,.15);border:1px solid rgba(232,106,101,.3);color:#e86a65;cursor:pointer;font-weight:600">
                    🛡 Détails IP
                </button>
            </div>`;
        marker.bindPopup(popupHtml, { maxWidth: 280, className: 'f2b-map-popup' });
        marker.on('popupopen', () => {
            const el = marker.getPopup()?.getElement();
            if (!el) return;
            const ipBtn = (el as Element).querySelector('.f2b-map-ip-btn') as HTMLButtonElement | null;
            if (ipBtn) ipBtn.onclick = () => onIpClickRef.current?.(point.ip);
        });
        metaByIp.current.set(point.ip, { country: geo.country, countryCode: geo.countryCode, region: geo.region, jails: point.jails });
        markerByIp.current.set(point.ip, marker);
    }, []);

    // ── Init map (once) ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!mapReady || !mapContainerRef.current || mapRef.current) return;
        try {
            const map = L.map(mapContainerRef.current, { zoomControl: true }).setView([26, 12], 3);
            mapRef.current = map;
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
                subdomains: 'abcd', maxZoom: 20,
            }).addTo(map);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const MCG = (L as any).markerClusterGroup ?? (window as any).L?.markerClusterGroup;
            if (!MCG) { setError('MarkerCluster non disponible — rechargez la page'); return; }
            clusterRef.current = MCG({ chunkedLoading: true, spiderfyOnMaxZoom: true, showCoverageOnHover: false });
            map.addLayer(clusterRef.current);
            requestAnimationFrame(() => { map.invalidateSize({ animate: false }); });
            setTimeout(() => map.invalidateSize({ animate: false }), 400);
            const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
            if (mapContainerRef.current) ro.observe(mapContainerRef.current);
            return () => { ro.disconnect(); };
        } catch (e) {
            setError(`${t('fail2ban.map.leafletError')} : ${e instanceof Error ? e.message : String(e)}`);
        }
    }, [mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Add cached markers whenever points change (source switch or first load) ─
    useEffect(() => {
        if (!mapRef.current || !clusterRef.current || !points.length) return;
        let done = 0;
        for (const p of points) {
            if (p.cached) { addMarker(p, p.cached); done++; }
        }
        setResolved(done);
        applyFilter('', '');
        rebuildStats();
    }, [points, addMarker, applyFilter, rebuildStats]);

    // ── Invalidate size when side panel toggles ────────────────────────────────
    useEffect(() => {
        if (!mapRef.current) return;
        setTimeout(() => mapRef.current?.invalidateSize({ animate: false }), 280);
    }, [asideOpen]);

    // ── Progressive geo resolution pump ───────────────────────────────────────
    useEffect(() => {
        if (!mapReady || !mapRef.current || pumpActiveRef.current) return;
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
    }, [mapReady, points, resolveDelayMs, addMarker, applyFilter, rebuildStats, filterCountry, filterRegion]);

    // ── Filter handlers ────────────────────────────────────────────────────────
    const handleCountryClick = useCallback((code: string) => {
        const next = filterCountry === code ? '' : code;
        setFilterCountry(next);
        setFilterRegion('');
        applyFilter(next, '');
        rebuildStats();
        if (next && mapRef.current) {
            
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
                    {loading ? t('fail2ban.map.loading') : `${total} IP${total > 1 ? 's' : ''} sur la carte`}
                </span>
                {!loading && total > 0 && mapReady && resolved < total && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', padding: '.18rem .6rem', borderRadius: 20, background: 'rgba(227,179,65,.1)', border: '1px solid rgba(227,179,65,.25)' }}>
                        <svg width="11" height="11" viewBox="0 0 11 11" style={{ flexShrink: 0 }}>
                            <circle cx="5.5" cy="5.5" r="4.5" fill="none" stroke="rgba(227,179,65,.3)" strokeWidth="1.5"/>
                            <circle className="f2b-geo-spin" cx="5.5" cy="5.5" r="4.5" fill="none" stroke="#e3b341" strokeWidth="1.5"
                                strokeDasharray={`${Math.round((resolved / total) * 28.3)} 28.3`}
                                strokeLinecap="round"/>
                        </svg>
                        <span style={{ fontSize: '.72rem', color: '#e3b341', fontWeight: 600 }}>{resolved}/{total}</span>
                        <span style={{ fontSize: '.68rem', color: '#8b949e' }}>·</span>
                        <span style={{ fontSize: '.68rem', color: '#8b949e' }}>{total - resolved} restante{total - resolved > 1 ? 's' : ''}</span>
                    </span>
                )}
                {!loading && total > 0 && mapReady && resolved >= total && total > 0 && (
                    <span style={{ fontSize: '.72rem', color: '#3fb950' }}>✓ {total} géolocalisée{total > 1 ? 's' : ''}</span>
                )}

                {/* Source toggle */}
                <div style={{ display: 'flex', gap: '.25rem', marginLeft: 'auto', background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '.15rem' }}>
                    <F2bTooltip color="red" title="🔴 Bans actifs"
                        bodyNode={<>IPs <strong style={{ color: '#e6edf3' }}>actuellement en jail</strong> dans fail2ban (ban non expiré).<br/>Source : <code style={{ fontFamily: 'monospace', fontSize: '.72rem', color: '#8b949e' }}>fail2ban.sqlite3</code><br/><span style={{ color: '#8b949e', fontSize: '.72rem' }}>Se vide si fail2ban redémarre ou purge sa DB (<code style={{ fontFamily: 'monospace' }}>dbpurgeage</code>).</span></>}>
                        <button onClick={() => setMapSource('live')} style={{
                            padding: '.2rem .65rem', fontSize: '.72rem', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                            border: `1px solid ${mapSource === 'live' ? 'rgba(232,106,101,.4)' : 'transparent'}`,
                            background: mapSource === 'live' ? 'rgba(232,106,101,.15)' : 'transparent',
                            color: mapSource === 'live' ? '#e86a65' : '#8b949e',
                        }}>🔴 Bans actifs</button>
                    </F2bTooltip>
                    <F2bTooltip color="blue" title="📦 Historique"
                        bodyNode={<>Toutes les IPs <strong style={{ color: '#e6edf3' }}>jamais bannies</strong> depuis le démarrage de la surveillance, bans expirés inclus.<br/>Source : <code style={{ fontFamily: 'monospace', fontSize: '.72rem', color: '#8b949e' }}>f2b_events</code><br/><span style={{ color: '#8b949e', fontSize: '.72rem' }}>Conservé indéfiniment, même après un redémarrage de fail2ban.</span></>}>
                        <button onClick={() => setMapSource('history')} style={{
                            padding: '.2rem .65rem', fontSize: '.72rem', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                            border: `1px solid ${mapSource === 'history' ? 'rgba(88,166,255,.4)' : 'transparent'}`,
                            background: mapSource === 'history' ? 'rgba(88,166,255,.15)' : 'transparent',
                            color: mapSource === 'history' ? '#58a6ff' : '#8b949e',
                        }}>📦 Historique</button>
                    </F2bTooltip>
                </div>

            </div>

            {/* Empty state */}
            {!loading && total === 0 && (
                <div style={{ ...card, padding: '3rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>🌐</div>
                    <p style={{ color: '#3fb950', fontWeight: 700, fontSize: '1rem', marginBottom: '.4rem' }}>Aucune IP à afficher</p>
                    <p style={{ color: '#8b949e', fontSize: '.82rem' }}>
                        {mapSource === 'live' ? 'Aucune IP actuellement bannie.' : 'Aucun historique de bans disponible.'}
                    </p>
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
                                {t('fail2ban.map.loading')}
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
                                    <span style={{ fontSize: '.85rem' }}>🌍</span> {t('fail2ban.map.filterByCountry')}
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
                                                    <FlagImg code={countryCodeMap[code] ?? code} size={16} />
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
