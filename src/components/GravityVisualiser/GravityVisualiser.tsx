import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { type Genre } from '../../data/stations';
import styles from './GravityVisualiser.module.css';

interface Props {
  onClose: () => void;
  genre?: Genre | Genre[];
  stationName?: string;
}

const GENRE_MODE: Record<Genre, string> = {
  'AMBIENT + CHILL': '3',
  'CLASSICAL':       '5',
  'DNB + RAVE':      '4',
  'DRAMA + TALK':    '2',
  'DUB + REGGAE':    '6',
  'ECLECTIC':        '0',
  'HIP HOP + RNB':   '9',
  'HOUSE + UKG':     '1',
  'JAZZ + EXOTICA':  '8',
  'LEGENDS + ERAS':  'a',
  'ROCK + INDIE':    '7',
  'SOUL + FUNK':     'b',
};

function genreToMode(genre?: Genre | Genre[]): string {
  if (!genre) return '6';
  const g = Array.isArray(genre) ? genre[0] : genre;
  return GENRE_MODE[g] ?? '6';
}

export function GravityVisualiser({ onClose, genre, stationName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<string>(genreToMode(genre));
  const switchModeRef = useRef<((key: string) => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const startMode = genreToMode(genre);
    modeRef.current = startMode;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050810);
    scene.fog = new THREE.FogExp2(new THREE.Color(0x050810), 0.02);

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const isDark = () => document.documentElement.dataset.theme === 'dark';
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: isDark() ? '#ffffff' : '#ffff00',
      wireframe: true,
      transparent: true,
      opacity: 1.0,
    });

    const themeObserver = new MutationObserver(() => {
      wireMaterial.color.set(isDark() ? '#ffffff' : '#ffff00');
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    type ModePreset = { speed: number; bg: number; fog: number; [key: string]: number };
    type ModeConfig = {
      init: (mat: THREE.Material) => THREE.Mesh;
      presets: Partial<ModePreset>[];
      update: (m: THREE.Mesh, delta: number, p: ModePreset, time: number, acc: number) => void;
      cam: { pos: [number, number, number]; look: [number, number, number] };
    };

    const modes: Record<string, ModeConfig> = {
      '1': {
        cam: { pos: [0, 6, 22], look: [0, -2, -30] },
        init: (mat) => {
          const geo = new THREE.PlaneGeometry(250, 250, 80, 80); geo.rotateX(-Math.PI / 2);
          const m = new THREE.Mesh(geo, mat); m.position.y = -3; return m;
        },
        presets: [{ speed: 15, h: 0.3, runway: 15, bg: 0x050810, fog: 0.02 }, { speed: 35, h: 0.6, runway: 10 }, { speed: 80, h: 1.0, runway: 5 }],
        update: (m, _d, p, _t, acc) => {
          const pos = m.geometry.attributes.position as THREE.BufferAttribute;
          const orig = m.userData.orig as Float32Array;
          m.position.z = acc % (250 / 80);
          for (let i = 0; i < pos.count; i++) {
            const x = orig[i * 3], z = orig[i * 3 + 2];
            const y = (Math.abs(x) > (p.runway ?? 15))
              ? (Math.sin(x * 0.15) + Math.cos((z + m.position.z) * 0.15 + acc * 0.2)) * ((Math.abs(x) - (p.runway ?? 15)) * (p.h ?? 0.3))
              : 0;
            pos.setY(i, y);
          }
          pos.needsUpdate = true;
        },
      },
      '2': {
        // Deep Sink — camera close, steep overhead angle looking into the hole
        cam: { pos: [0, 35, 18], look: [0, -55, 0] },
        init: (mat) => {
          const geo = new THREE.PlaneGeometry(250, 250, 100, 100); geo.rotateX(-Math.PI / 2);
          return new THREE.Mesh(geo, mat);
        },
        presets: [{ speed: 10, bg: 0x0a0c20, sink: 120, fog: 0.005 }, { speed: 30, sink: 180 }, { speed: 70, sink: 250 }],
        update: (m, _d, p, _t, acc) => {
          const pos = m.geometry.attributes.position as THREE.BufferAttribute;
          const orig = m.userData.orig as Float32Array;
          m.position.z = (acc * 0.4) % 2.5;
          for (let i = 0; i < pos.count; i++) {
            const ox = orig[i * 3], oz = orig[i * 3 + 2];
            const d = Math.sqrt(ox * ox + (oz + m.position.z) ** 2);
            pos.setY(i, -((p.sink ?? 120) / (d * 0.15 + 1.0)) + Math.sin(d * 0.4 - acc * 0.3) * 2.0);
          }
          pos.needsUpdate = true;
        },
      },
      '3': {
        cam: { pos: [0, 18, 35], look: [0, 0, 0] },
        init: (mat) => {
          const geo = new THREE.PlaneGeometry(120, 120, 60, 60); geo.rotateX(-Math.PI / 2);
          const m = new THREE.Mesh(geo, mat); m.position.y = -2; return m;
        },
        presets: [{ speed: 3, freq: 0.3, amp: 1.0, bg: 0x000011, fog: 0.02 }, { speed: 9, freq: 0.6, amp: 2.5 }, { speed: 20, freq: 1.0, amp: 5.0 }],
        update: (m, _d, p, _t, acc) => {
          const pos = m.geometry.attributes.position as THREE.BufferAttribute;
          const orig = m.userData.orig as Float32Array;
          for (let i = 0; i < pos.count; i++) {
            pos.setY(i, Math.sin(Math.sqrt(orig[i * 3] ** 2 + orig[i * 3 + 2] ** 2) * (p.freq ?? 0.3) - acc * 0.5) * (p.amp ?? 1.0));
          }
          pos.needsUpdate = true;
        },
      },
      '4': {
        cam: { pos: [0, 0, 18], look: [0, 0, -50] },
        init: (mat) => new THREE.Mesh(new THREE.BoxGeometry(30, 30, 120, 10, 10, 40), mat),
        presets: [{ speed: 12, roll: 0.05, bg: 0x000510, fog: 0.012 }, { speed: 40, roll: 0.35, fog: 0.01 }, { speed: 90, roll: 1.5, fog: 0.008 }],
        update: (m, _d, p, time, acc) => { m.position.z = acc % 3; m.rotation.z = time * (p.roll ?? 0.05); },
      },
      '5': {
        cam: { pos: [0, 20, 90], look: [0, 0, 0] },
        init: (mat) => new THREE.Mesh(new THREE.BoxGeometry(60, 60, 60, 8, 8, 8), mat),
        presets: [{ speed: 0.5, rx: 0.05, ry: 0.08, bg: 0x080808, fog: 0.01 }, { speed: 1.8, rx: 0.2, ry: 0.3, fog: 0.008 }, { speed: 7.0, rx: 1.0, ry: 1.5, fog: 0.005 }],
        update: (m, delta, p) => { m.rotation.x += delta * (p.rx ?? 0.05); m.rotation.y += delta * (p.ry ?? 0.08); },
      },
      '6': {
        // Gravity Peak — close enough to see the mountain fill the frame
        cam: { pos: [0, 25, 45], look: [0, 30, 0] },
        init: (mat) => {
          const geo = new THREE.PlaneGeometry(300, 300, 100, 100); geo.rotateX(-Math.PI / 2);
          return new THREE.Mesh(geo, mat);
        },
        presets: [{ speed: 12, bg: 0x0a0c16, peak: 130, fog: 0.005 }, { speed: 30, peak: 180 }, { speed: 80, peak: 250 }],
        update: (m, _d, p, _t, acc) => {
          const pos = m.geometry.attributes.position as THREE.BufferAttribute;
          const orig = m.userData.orig as Float32Array;
          m.position.z = (acc * 0.4) % 3.0;
          for (let i = 0; i < pos.count; i++) {
            const ox = orig[i * 3], oz = orig[i * 3 + 2];
            const d = Math.sqrt(ox * ox + (oz + m.position.z) ** 2);
            pos.setY(i, ((p.peak ?? 130) / (d * 0.18 + 1.5)) + Math.cos(d * 0.3 - acc * 0.4) * 2.0);
          }
          pos.needsUpdate = true;
        },
      },
      '7': {
        cam: { pos: [0, 25, 65], look: [0, 0, 0] },
        init: (mat) => {
          const geo = new THREE.PlaneGeometry(250, 250, 60, 60); geo.rotateX(-Math.PI / 2);
          return new THREE.Mesh(geo, mat);
        },
        presets: [{ speed: 15, amp: 5, bg: 0x050810, fog: 0.02 }, { speed: 40, amp: 12 }, { speed: 100, amp: 20 }],
        update: (m, _d, p, time) => {
          const pos = m.geometry.attributes.position as THREE.BufferAttribute;
          const orig = m.userData.orig as Float32Array;
          for (let i = 0; i < pos.count; i++) {
            pos.setY(i, Math.sin(orig[i * 3] * 0.08 + time) * (p.amp ?? 5));
          }
          pos.needsUpdate = true;
        },
      },
      '8': {
        cam: { pos: [0, 40, 55], look: [0, 0, 0] },
        init: (mat) => {
          const geo = new THREE.PlaneGeometry(200, 200, 50, 50); geo.rotateX(-Math.PI / 2);
          return new THREE.Mesh(geo, mat);
        },
        presets: [{ speed: 20, amp: 8, bg: 0x050810, fog: 0.015 }, { speed: 45, amp: 15 }, { speed: 100, amp: 25 }],
        update: (m, _d, p, time, acc) => {
          const pos = m.geometry.attributes.position as THREE.BufferAttribute;
          const orig = m.userData.orig as Float32Array;
          for (let i = 0; i < pos.count; i++) {
            pos.setY(i, Math.sin(orig[i * 3] * 0.1 + time) * Math.cos(orig[i * 3 + 2] * 0.1 + acc * 0.1) * (p.amp ?? 8));
          }
          pos.needsUpdate = true;
        },
      },
      '9': {
        cam: { pos: [0, 8, 30], look: [0, 0, -50] },
        init: (mat) => new THREE.Mesh(new THREE.BoxGeometry(60, 60, 400, 10, 10, 20), mat),
        presets: [{ speed: 40, bg: 0x050510, fog: 0.008 }, { speed: 80 }, { speed: 150 }],
        update: (m, _d, _p, time, acc) => { m.position.z = acc % 100; m.rotation.z = time * 0.1; },
      },
      '0': {
        cam: { pos: [0, 15, 65], look: [0, 0, 0] },
        init: (mat) => new THREE.Mesh(new THREE.TorusKnotGeometry(25, 2, 100, 16), mat),
        presets: [{ speed: 10, rot: 0.5, bg: 0x050a0a, fog: 0.01 }, { speed: 30, rot: 1.5 }, { speed: 70, rot: 4.0 }],
        update: (m, _d, p, time) => {
          m.rotation.y = time * (p.rot ?? 0.5);
          m.rotation.z = time * ((p.rot ?? 0.5) * 0.3);
        },
      },
      'a': {
        cam: { pos: [0, 55, 90], look: [0, 0, 0] },
        init: (mat) => {
          const geo = new THREE.PlaneGeometry(200, 200, 50, 50); geo.rotateX(-Math.PI / 2);
          return new THREE.Mesh(geo, mat);
        },
        presets: [{ speed: 4, amp: 12, bg: 0x080510, fog: 0.008 }, { speed: 10, amp: 22 }, { speed: 22, amp: 36 }],
        update: (m, _d, p, time) => {
          const pos = m.geometry.attributes.position as THREE.BufferAttribute;
          const orig = m.userData.orig as Float32Array;
          for (let i = 0; i < pos.count; i++) {
            const x = orig[i * 3], z = orig[i * 3 + 2];
            pos.setY(i, Math.sin(x * 0.05 + time * 0.7) * Math.sin(z * 0.05 + time * 0.5) * (p.amp ?? 12));
          }
          pos.needsUpdate = true;
          m.rotation.y = time * 0.08;
        },
      },
      'b': {
        cam: { pos: [0, 12, 55], look: [0, 0, 0] },
        init: (mat) => new THREE.Mesh(new THREE.SphereGeometry(20, 36, 36), mat),
        presets: [{ speed: 8, amp: 0.3, freq: 3.0, bg: 0x0a0508, fog: 0.012 }, { speed: 18, amp: 0.55, freq: 5.0 }, { speed: 40, amp: 0.85, freq: 8.0 }],
        update: (m, _d, p, time) => {
          const pos = m.geometry.attributes.position as THREE.BufferAttribute;
          const orig = m.userData.orig as Float32Array;
          for (let i = 0; i < pos.count; i++) {
            const ox = orig[i * 3], oy = orig[i * 3 + 1], oz = orig[i * 3 + 2];
            const len = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
            const nx = ox / len, ny = oy / len, nz = oz / len;
            const pulse = 1 + Math.sin(time * (p.freq ?? 3) + nx * 6 + nz * 6) * (p.amp ?? 0.3);
            pos.setXYZ(i, nx * 20 * pulse, ny * 20 * pulse, nz * 20 * pulse);
          }
          pos.needsUpdate = true;
          m.rotation.y = time * 0.25;
        },
      },
    };

    function setupVertexCache(o: THREE.Object3D) {
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry?.attributes.position) {
          mesh.userData.orig = (mesh.geometry.attributes.position.array as Float32Array).slice();
        }
      }
    }

    const modeObjects: Record<string, THREE.Mesh> = {};
    Object.keys(modes).forEach(key => {
      const obj = modes[key].init(wireMaterial);
      setupVertexCache(obj);
      obj.visible = false;
      scene.add(obj);
      modeObjects[key] = obj;
    });

    let currentKey = startMode;
    let presetIdx = 0;
    let activeObj: THREE.Mesh = modeObjects[currentKey];
    let activeMode: ModeConfig = modes[currentKey];
    let targetP: ModePreset = { ...activeMode.presets[0] } as ModePreset;
    let currentP: ModePreset = { ...targetP };
    const targetBg = new THREE.Color();

    function switchMode(key: string) {
      currentKey = key;
      if (activeObj) activeObj.visible = false;
      activeMode = modes[key];
      activeObj = modeObjects[key];
      activeObj.visible = true;
      presetIdx = 0;
      targetP = { ...activeMode.presets[0] } as ModePreset;
      currentP = { ...targetP };
      targetBg.setHex(targetP.bg ?? 0x050810);
      scene.background = (scene.background as THREE.Color).copy(targetBg);
      if (scene.fog) {
        (scene.fog as THREE.FogExp2).color.copy(targetBg);
        (scene.fog as THREE.FogExp2).density = targetP.fog ?? 0.02;
      }
      modeRef.current = key;
    }

    switchMode(currentKey);
    switchModeRef.current = switchMode;

    const handleKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (modes[k]) {
        if (modeRef.current === k) {
          presetIdx = (presetIdx + 1) % activeMode.presets.length;
          targetP = { ...targetP, ...activeMode.presets[presetIdx] } as ModePreset;
        } else {
          currentKey = k;
          switchMode(k);
        }
      }
    };
    window.addEventListener('keydown', handleKey);

    const clock = new THREE.Clock();
    let acc = 0;
    let animId: number;

    function animate() {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const time = clock.getElapsedTime();

      for (const k in targetP) {
        if (k !== 'bg' && typeof targetP[k] === 'number') {
          (currentP as Record<string, number>)[k] += (targetP[k] - (currentP as Record<string, number>)[k]) * 0.08;
        }
      }

      if (targetP.bg !== undefined) {
        targetBg.setHex(targetP.bg);
        (scene.background as THREE.Color).lerp(targetBg, 0.05);
        if (scene.fog) {
          (scene.fog as THREE.FogExp2).color.lerp(targetBg, 0.05);
          (scene.fog as THREE.FogExp2).density += ((targetP.fog ?? 0.02) - (scene.fog as THREE.FogExp2).density) * 0.05;
        }
      }

      acc += (currentP.speed ?? 10) * delta;

      const { pos, look } = activeMode.cam;
      camera.position.lerp(new THREE.Vector3(...pos), 0.1);
      camera.lookAt(...look);

      if (activeMode && activeObj) activeMode.update(activeObj, delta, currentP, time, acc);

      wireMaterial.opacity = 0.95 + Math.sin(time * 20) * 0.04 + Math.random() * 0.01;
      renderer.render(scene, camera);
    }

    animate();

    const handleResize = () => {
      if (!container) return;
      renderer.setSize(container.clientWidth, container.clientHeight);
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleResize);
      themeObserver.disconnect();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  // Switch mode when genre changes (e.g. user taps a new genre pad while viz is open)
  useEffect(() => {
    switchModeRef.current?.(genreToMode(genre));
  }, [genre]);

  return (
    <div className={styles.root} onClick={onClose}>
      <div ref={containerRef} className={styles.canvas} />
      <div className={styles.scanlines} />
      <div className={styles.vignette} />
      {stationName && (
        <div className={styles.stationLabel}>{stationName.toUpperCase()}</div>
      )}
    </div>
  );
}
