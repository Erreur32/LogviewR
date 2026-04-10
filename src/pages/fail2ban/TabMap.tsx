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
import { Map as MapIcon, SlidersHorizontal, Zap } from 'lucide-react';
import { FlagImg } from './FlagImg';
import { useNotificationStore } from '../../stores/notificationStore';

// ── Types ─────────────────────────────────────────────────────────────────────
interface GeoData { lat: number; lng: number; country: string; countryCode: string; region: string; city: string; org: string }
interface MapPoint { ip: string; jails: string[]; cached: GeoData | null }
interface LiveEvent { ip: string; jail: string; timeofban: number; failures: number; geo: { lat: number; lng: number; country: string; countryCode: string; city: string; org: string } }

// ── Helpers ───────────────────────────────────────────────────────────────────

const FLAG_BASE = '/icons/country';

/** Flag img tag — local SVG, for use in raw HTML strings */
function flagImgHtml(code: string): string {
    const c = (code || '').toLowerCase().replaceAll(/[^a-z]/g, '');
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

    // ── Live attack mode ──────────────────────────────────────────────────────
    const [liveMode, setLiveMode]             = useState(false);
    const [serverGeo, setServerGeo]           = useState<{ lat: number; lng: number; country: string; city: string } | null>(null);
    const [liveEvents, setLiveEvents]         = useState<LiveEvent[]>([]);
    const liveIntervalRef                     = useRef<ReturnType<typeof setInterval> | null>(null);
    const liveSinceRef                        = useRef<number>(0);
    const attackLinesRef                      = useRef<any[]>([]);

    // ── Inject dark popup CSS once ─────────────────────────────────────────────
    useEffect(() => {
        if (!document.getElementById('f2b-map-popup-style')) {
            const s = document.createElement('style');
            s.id = 'f2b-map-popup-style';
            s.textContent = `
                @keyframes f2b-spin { to { transform: rotate(360deg) translateZ(0); } }
                .f2b-geo-spin { animation: f2b-spin 1.2s linear infinite; transform-origin: 5.5px 5.5px; }
                @keyframes f2b-attack-fly {
                    0%   { stroke-dashoffset: 1000; opacity: 0; }
                    6%   { opacity: 0.9; }
                    75%  { opacity: 0.8; }
                    100% { stroke-dashoffset: 0; opacity: 0; }
                }
                @keyframes f2b-pulse-ring {
                    0%   { transform: scale(1); opacity: 0.8; }
                    100% { transform: scale(2.5); opacity: 0; }
                }
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
        if (!mapRef.current || !clusterRef.current || !points.length || liveMode) return;
        let done = 0;
        for (const p of points) {
            if (p.cached) { addMarker(p, p.cached); done++; }
        }
        setResolved(done);
        applyFilter('', '');
        rebuildStats();
    }, [points, liveMode, addMarker, applyFilter, rebuildStats]);

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

    // ── Live attack mode ───────────────────────────────────────────────────────

    /** Inject arrowhead <marker> into Leaflet's overlay SVG once */
    const ensureArrowMarker = useCallback(() => {
        if (!mapRef.current) return;
        const overlayPane = mapRef.current.getPanes().overlayPane as HTMLElement;
        const svg = overlayPane.querySelector('svg');
        if (!svg || svg.querySelector('#f2b-arrow')) return;
        const ns = 'http://www.w3.org/2000/svg';
        const defs  = document.createElementNS(ns, 'defs');
        const mkr   = document.createElementNS(ns, 'marker');
        mkr.setAttribute('id', 'f2b-arrow');
        mkr.setAttribute('markerWidth', '6');
        mkr.setAttribute('markerHeight', '6');
        mkr.setAttribute('refX', '5');
        mkr.setAttribute('refY', '3');
        mkr.setAttribute('orient', 'auto');
        mkr.setAttribute('markerUnits', 'strokeWidth');
        const arrowTip = document.createElementNS(ns, 'path');
        arrowTip.setAttribute('d', 'M0,0 L0,6 L6,3 z');
        arrowTip.setAttribute('fill', 'rgba(232,106,101,0.9)');
        mkr.appendChild(arrowTip);
        defs.appendChild(mkr);
        svg.prepend(defs);
    }, []);

    const drawAttackArc = useCallback((srcLat: number, srcLng: number, geo: { country: string; countryCode: string; city: string; org: string }, ip: string, jail: string) => {
        if (!mapRef.current || !serverGeo) return;
        ensureArrowMarker();

        const src = L.latLng(srcLat, srcLng);
        const dst = L.latLng(serverGeo.lat, serverGeo.lng);

        // Polyline — opacity:0 initially, animation takes over
        const line = L.polyline([src, dst], { color: '#e86a65', weight: 2, opacity: 0 } as any);
        line.addTo(mapRef.current);

        // Apply after rAF so the element is in the DOM
        requestAnimationFrame(() => {
            const el = (line as any).getElement() as SVGElement | null;
            if (!el) return;
            el.setAttribute('stroke', '#e86a65');
            el.setAttribute('stroke-width', '2');
            el.setAttribute('stroke-dasharray', '1000');
            el.setAttribute('stroke-dashoffset', '1000');
            el.setAttribute('marker-end', 'url(#f2b-arrow)');
            el.setAttribute('fill', 'none');
            el.style.cssText = 'stroke-dasharray:1000;stroke-dashoffset:1000;animation:f2b-attack-fly 2.5s ease-out forwards;';
        });

        // Pulsing origin dot (two rings)
        const dotDiv = document.createElement('div');
        dotDiv.style.cssText = 'width:12px;height:12px;border-radius:50%;background:rgba(232,106,101,.85);border:2px solid #e86a65;position:relative;';
        const ring1 = document.createElement('div');
        ring1.style.cssText = 'position:absolute;inset:-5px;border-radius:50%;border:2px solid rgba(232,106,101,.5);animation:f2b-pulse-ring 1.2s ease-out infinite;';
        const ring2 = document.createElement('div');
        ring2.style.cssText = 'position:absolute;inset:-10px;border-radius:50%;border:1px solid rgba(232,106,101,.25);animation:f2b-pulse-ring 1.2s ease-out 0.4s infinite;';
        dotDiv.appendChild(ring1);
        dotDiv.appendChild(ring2);

        const pulseIcon = L.divIcon({ className: '', html: dotDiv.outerHTML, iconSize: [12, 12], iconAnchor: [6, 6] });
        const dot = L.marker(src, { icon: pulseIcon, interactive: true });

        // Safe popup — build via DOM, not via HTML string with user data
        const popupDiv = document.createElement('div');
        const ipEl = document.createElement('div');
        ipEl.style.cssText = 'font-family:monospace;font-size:.75rem;color:#e86a65;font-weight:700;';
        ipEl.textContent = ip;
        const locEl = document.createElement('div');
        locEl.style.cssText = 'font-size:.7rem;color:#8b949e;margin-top:.2rem;';
        locEl.textContent = [geo.city, geo.country].filter(Boolean).join(', ') || '—';
        const jailEl = document.createElement('div');
        jailEl.style.cssText = 'font-size:.68rem;color:#3fb950;margin-top:.15rem;';
        jailEl.textContent = `jail : ${jail}`;
        popupDiv.appendChild(ipEl);
        popupDiv.appendChild(locEl);
        popupDiv.appendChild(jailEl);
        dot.bindPopup(popupDiv, { maxWidth: 200, className: 'f2b-map-popup' });
        dot.addTo(mapRef.current);

        attackLinesRef.current.push(line, dot);
        setTimeout(() => { if (mapRef.current) line.remove(); attackLinesRef.current = attackLinesRef.current.filter(l => l !== line); }, 2700);
        setTimeout(() => { if (mapRef.current) dot.remove();  attackLinesRef.current = attackLinesRef.current.filter(l => l !== dot);  }, 6000);
    }, [serverGeo, ensureArrowMarker]);

    const pollLiveEvents = useCallback(() => {
        const since = liveSinceRef.current;
        api.get<{ ok: boolean; events: LiveEvent[]; serverTime: number }>(`/api/plugins/fail2ban/map/events?since=${since}&limit=30`)
            .then(res => {
                if (!res.success || !res.result?.ok) return;
                const evts = res.result.events;
                if (evts.length > 0) {
                    setLiveEvents(prev => [...evts, ...prev].slice(0, 50));
                    const { addBan } = useNotificationStore.getState();
                    evts.forEach(e => {
                        drawAttackArc(e.geo.lat, e.geo.lng, e.geo, e.ip, e.jail);
                        addBan({ ip: e.ip, jail: e.jail, failures: e.failures, timeofban: e.timeofban });
                    });
                }
                liveSinceRef.current = res.result.serverTime;
            })
            .catch(() => {});
    }, [drawAttackArc]);

    useEffect(() => {
        if (!liveMode) {
            if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
            // Clean up attack lines and restore ban markers
            attackLinesRef.current.forEach(l => { try { l.remove(); } catch { /* already removed */ } });
            attackLinesRef.current = [];
            // Restore existing ban markers into cluster
            if (clusterRef.current) {
                clusterRef.current.clearLayers();
                for (const [, marker] of markerByIp.current) clusterRef.current.addLayer(marker);
            }
            setLiveEvents([]);
            return;
        }
        // Clear existing ban markers — live mode shows only attack arcs
        if (clusterRef.current) clusterRef.current.clearLayers();

        // Fetch server geo once
        if (!serverGeo) {
            api.get<{ ok: boolean; lat: number; lng: number; country: string; city: string }>('/api/plugins/fail2ban/map/server-geo')
                .then(res => {
                    if (res.success && res.result?.ok) setServerGeo({ lat: res.result.lat, lng: res.result.lng, country: res.result.country ?? '', city: res.result.city ?? '' });
                })
                .catch(() => {});
        }
        // Seed since = now − 60s to show last minute of attacks on first load
        liveSinceRef.current = Math.floor(Date.now() / 1000) - 60;
        pollLiveEvents();
        liveIntervalRef.current = setInterval(pollLiveEvents, 5000);
        return () => { if (liveIntervalRef.current) clearInterval(liveIntervalRef.current); };
    }, [liveMode]); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-run pollLiveEvents when serverGeo becomes available (first activation)
    useEffect(() => {
        if (liveMode && serverGeo) pollLiveEvents();
    }, [serverGeo]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', height: 'calc(100vh - 165px)', overflow: 'hidden' }}>

            {/* Top bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexShrink: 0 }}>
                <MapIcon style={{ width: 15, height: 15, color: '#58a6ff' }} />
                <span style={{ fontWeight: 600, fontSize: '.88rem', color: '#58a6ff' }}>
                    {loading ? t('fail2ban.map.loading') : liveMode ? '⚡ Mode Live' : `${total} IP${total > 1 ? 's' : ''} sur la carte`}
                </span>
                {!liveMode && !loading && total > 0 && mapReady && resolved < total && (
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
                {!liveMode && !loading && total > 0 && mapReady && resolved >= total && total > 0 && (
                    <span style={{ fontSize: '.72rem', color: '#3fb950' }}>✓ {total} géolocalisée{total > 1 ? 's' : ''}</span>
                )}
                {liveMode && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', padding: '.18rem .6rem', borderRadius: 20, background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.25)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e86a65', display: 'inline-block', animation: 'f2b-pulse-ring .9s ease-out infinite', flexShrink: 0 }} />
                        <span style={{ fontSize: '.72rem', color: '#e86a65', fontWeight: 700 }}>{liveEvents.length}</span>
                        <span style={{ fontSize: '.68rem', color: '#8b949e' }}>tentative{liveEvents.length !== 1 ? 's' : ''} détectée{liveEvents.length !== 1 ? 's' : ''}</span>
                    </span>
                )}

                {/* Live mode toggle */}
                <F2bTooltip color="red" title="⚡ Mode Live"
                    bodyNode={<>Suit les <strong style={{ color: '#e6edf3' }}>nouveaux bans en temps réel</strong> (poll toutes les 5s).<br/>Affiche des arcs animés depuis la source de l'attaque vers votre serveur.<br/><span style={{ color: '#8b949e', fontSize: '.72rem' }}>Les IPs sans géolocalisation cachée sont silencieusement ignorées.</span></>}>
                    <button onClick={() => setLiveMode(m => !m)} style={{
                        display: 'inline-flex', alignItems: 'center', gap: '.3rem',
                        padding: '.2rem .65rem', fontSize: '.72rem', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
                        border: `1px solid ${liveMode ? 'rgba(232,106,101,.6)' : '#30363d'}`,
                        background: liveMode ? 'rgba(232,106,101,.15)' : '#21262d',
                        color: liveMode ? '#e86a65' : '#8b949e',
                        marginLeft: 'auto',
                        animation: liveMode ? undefined : undefined,
                    }}>
                        <Zap style={{ width: 11, height: 11 }} />
                        Live
                        {liveMode && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e86a65', display: 'inline-block', animation: 'f2b-pulse-ring .9s ease-out infinite', flexShrink: 0 }} />}
                    </button>
                </F2bTooltip>

                {/* Source toggle */}
                <div style={{ display: 'flex', gap: '.25rem', background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '.15rem' }}>
                    <F2bTooltip color="red" title="🔴 Bans actifs"
                        bodyNode={<>IPs <strong style={{ color: '#e6edf3' }}>actuellement en jail</strong> dans fail2ban (ban non expiré).<br/>Source : <code style={{ fontFamily: 'monospace', fontSize: '.72rem', color: '#8b949e' }}>fail2ban.sqlite3</code><br/><span style={{ color: '#8b949e', fontSize: '.72rem' }}>Se vide si fail2ban redémarre ou purge sa DB (<code style={{ fontFamily: 'monospace' }}>dbpurgeage</code>).</span></>}>
                        <button onClick={() => { setMapSource('live'); setLiveMode(false); }} style={{
                            padding: '.2rem .65rem', fontSize: '.72rem', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                            border: `1px solid ${!liveMode && mapSource === 'live' ? 'rgba(232,106,101,.4)' : 'transparent'}`,
                            background: !liveMode && mapSource === 'live' ? 'rgba(232,106,101,.15)' : 'transparent',
                            color: !liveMode && mapSource === 'live' ? '#e86a65' : '#8b949e',
                        }}>🔴 Bans actifs</button>
                    </F2bTooltip>
                    <F2bTooltip color="blue" title="📦 Historique"
                        bodyNode={<>Toutes les IPs <strong style={{ color: '#e6edf3' }}>jamais bannies</strong> depuis le démarrage de la surveillance, bans expirés inclus.<br/>Source : <code style={{ fontFamily: 'monospace', fontSize: '.72rem', color: '#8b949e' }}>f2b_events</code><br/><span style={{ color: '#8b949e', fontSize: '.72rem' }}>Conservé indéfiniment, même après un redémarrage de fail2ban.</span></>}>
                        <button onClick={() => { setMapSource('history'); setLiveMode(false); }} style={{
                            padding: '.2rem .65rem', fontSize: '.72rem', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                            border: `1px solid ${!liveMode && mapSource === 'history' ? 'rgba(88,166,255,.4)' : 'transparent'}`,
                            background: !liveMode && mapSource === 'history' ? 'rgba(88,166,255,.15)' : 'transparent',
                            color: !liveMode && mapSource === 'history' ? '#58a6ff' : '#8b949e',
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

                    {/* Live attack feed — left panel */}
                    {liveMode && (
                        <aside style={{ width: 220, flexShrink: 0, borderRight: '1px solid #30363d', display: 'flex', flexDirection: 'column', background: '#0d1117' }}>
                            <div style={{ padding: '.5rem .75rem', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.35rem', flexShrink: 0 }}>
                                <Zap style={{ width: 12, height: 12, color: '#e86a65' }} />
                                <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#e86a65', letterSpacing: '.04em', textTransform: 'uppercase' as const }}>Flux live</span>
                                {serverGeo && <span style={{ marginLeft: 'auto', fontSize: '.6rem', color: '#555d69' }}>→ {serverGeo.city || serverGeo.country || '?'}</span>}
                            </div>
                            <div style={{ overflowY: 'auto', flex: 1 }}>
                                {liveEvents.length === 0 ? (
                                    <div style={{ padding: '.75rem', fontSize: '.72rem', color: '#555d69', fontStyle: 'italic', textAlign: 'center', marginTop: '.5rem' }}>
                                        En attente de bans…
                                        <div style={{ marginTop: '.4rem', display: 'flex', justifyContent: 'center' }}>
                                            <svg width="11" height="11" viewBox="0 0 11 11"><circle cx="5.5" cy="5.5" r="4.5" fill="none" stroke="rgba(232,106,101,.3)" strokeWidth="1.5"/><circle className="f2b-geo-spin" cx="5.5" cy="5.5" r="4.5" fill="none" stroke="#e86a65" strokeWidth="1.5" strokeDasharray="8 20" strokeLinecap="round"/></svg>
                                        </div>
                                    </div>
                                ) : liveEvents.map((e, i) => {
                                    const ago = Math.floor(Date.now() / 1000) - e.timeofban;
                                    const agoStr = ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.floor(ago / 60)}m` : `${Math.floor(ago / 3600)}h`;
                                    const isRecent = ago < 10;
                                    return (
                                        <div key={`${e.ip}-${e.timeofban}-${i}`} style={{ padding: '.35rem .65rem', borderBottom: '1px solid rgba(255,255,255,.035)', background: isRecent ? 'rgba(232,106,101,.06)' : undefined }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem', marginBottom: '.1rem' }}>
                                                {isRecent && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#e86a65', flexShrink: 0, display: 'inline-block' }} />}
                                                <span style={{ fontFamily: 'monospace', fontSize: '.68rem', color: isRecent ? '#e86a65' : '#c9d1d9', fontWeight: isRecent ? 700 : 400, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{e.ip}</span>
                                                <span style={{ fontSize: '.58rem', color: '#444d56', flexShrink: 0 }}>{agoStr}</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem', flexWrap: 'wrap' as const }}>
                                                <span style={{ fontSize: '.62rem', color: '#3fb950' }}>{e.jail}</span>
                                                {e.geo.city && <><span style={{ color: '#30363d' }}>·</span><span style={{ fontSize: '.6rem', color: '#8b949e' }}>{e.geo.city}</span></>}
                                                {e.geo.countryCode && <FlagImg code={e.geo.countryCode} size={11} />}
                                                {e.failures > 0 && <span style={{ fontSize: '.6rem', color: '#e3b341', marginLeft: 'auto' }}>{e.failures}×</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </aside>
                    )}

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

                            {/* Country section — disabled in live mode */}
                            <div style={{ borderBottom: '1px solid #30363d', opacity: liveMode ? 0.3 : 1, pointerEvents: liveMode ? 'none' : undefined, transition: 'opacity .2s' }}>
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

                            {/* Region section — disabled in live mode */}
                            {filterCountry && !liveMode && (
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
