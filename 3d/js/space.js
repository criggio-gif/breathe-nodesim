/*
 * NodeSim 3D - the virtual space
 *
 * A holographic table: the nodes float over a glowing grid, organized on the horizontal
 * plane in bands (one band per area of physiology, from the ventilator settings on the
 * left to oxygen transport on the right). Each node is a small HUD instrument: a crystal
 * core, a wireframe shell and rotating reticles. Links arc over the table; pulses of light
 * travel along them: green when the change pushes the target node up, red when it pushes
 * it down. Node labels are HTML elements projected on top of the WebGL canvas.
 */
(function (global) {
	'use strict';

	const T = global.THREE;
	const UP = new T.Color('#3ee08f'), DOWN = new T.Color('#ff5b6b'), NEUTRAL = new T.Color('#8fdcff');
	const HOLO = new T.Color('#5fe3ff');
		const OFF = new T.Color('#56606a');
	const CAT_COLORS = { vent: '#4fd4ef', pat: '#d2bb8c', mech: '#a88cff', gas: '#4be0a0', hemo: '#ff6b82', o2: '#ffb14a' };
	const BANDS = ['Impostazioni · Paziente', 'Meccanica respiratoria', 'Volumi · Scambi gassosi', 'Circolo polmonare · Cuore dx', 'Emodinamica sistemica', 'Trasporto di O₂ · Metabolismo'];
	const BAND_GAP = 10.4, ROW_GAP = 3.3, FLOOR_Y = -2.2, NODE_Y = 1.2;

	/* ------------------------------------------------------------ canvas textures */

	function canvasTexture(size, draw) {
		const c = document.createElement('canvas');
		c.width = c.height = size;
		draw(c.getContext('2d'), size);
		const t = new T.CanvasTexture(c);
		t.anisotropy = 4;
		return t;
	}

	function glowTexture() {
		return canvasTexture(128, (g, s) => {
			const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
			grd.addColorStop(0, 'rgba(255,255,255,1)');
			grd.addColorStop(0.2, 'rgba(255,255,255,0.6)');
			grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
			grd.addColorStop(1, 'rgba(255,255,255,0)');
			g.fillStyle = grd;
			g.fillRect(0, 0, s, s);
		});
	}

	//outer reticle: thin circle with a tick scale, longer ticks every 30 degrees
	function ticksTexture() {
		return canvasTexture(256, (g, s) => {
			const c = s / 2;
			g.strokeStyle = '#fff';
			g.lineWidth = 2;
			g.beginPath(); g.arc(c, c, 120, 0, Math.PI * 2); g.stroke();
			for (let a = 0; a < 360; a += 6) {
				const r0 = a % 30 === 0 ? 100 : 110, rad = a * Math.PI / 180;
				g.lineWidth = a % 30 === 0 ? 3 : 1.5;
				g.beginPath();
				g.moveTo(c + Math.cos(rad) * r0, c + Math.sin(rad) * r0);
				g.lineTo(c + Math.cos(rad) * 116, c + Math.sin(rad) * 116);
				g.stroke();
			}
		});
	}

	//inner reticle: three thick arcs and a dashed circle
	function arcsTexture() {
		return canvasTexture(256, (g, s) => {
			const c = s / 2;
			g.strokeStyle = '#fff';
			g.lineWidth = 9;
			[0, 1, 2].forEach(k => {
				g.beginPath();
				g.arc(c, c, 104, k * 2.094 + 0.2, k * 2.094 + 1.35);
				g.stroke();
			});
			g.lineWidth = 2;
			g.setLineDash([6, 8]);
			g.beginPath(); g.arc(c, c, 80, 0, Math.PI * 2); g.stroke();
		});
	}

	//selection brackets, always facing the camera
	function bracketsTexture() {
		return canvasTexture(256, (g, s) => {
			g.strokeStyle = '#fff';
			g.lineWidth = 7;
			const m = 16, l = 58;
			[[m, m, 1, 1], [s - m, m, -1, 1], [m, s - m, 1, -1], [s - m, s - m, -1, -1]].forEach(([x, y, dx, dy]) => {
				g.beginPath();
				g.moveTo(x, y + dy * l); g.lineTo(x, y); g.lineTo(x + dx * l, y);
				g.stroke();
			});
		});
	}

	//holographic table: fine and major grid, concentric rings, fading out towards the edges
	function floorTexture() {
		return canvasTexture(1024, (g, s) => {
			const c = s / 2;
			g.strokeStyle = 'rgba(95,227,255,0.10)';
			g.lineWidth = 1;
			for (let i = 0; i <= s; i += 16) {
				g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke();
				g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke();
			}
			g.strokeStyle = 'rgba(95,227,255,0.28)';
			for (let i = 0; i <= s; i += 128) {
				g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke();
				g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke();
			}
			g.strokeStyle = 'rgba(95,227,255,0.22)';
			[140, 250, 360, 470].forEach(r => { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); });
			const glow = g.createRadialGradient(c, c, 0, c, c, c);
			glow.addColorStop(0, 'rgba(40,150,190,0.30)');
			glow.addColorStop(0.6, 'rgba(20,90,120,0.08)');
			glow.addColorStop(1, 'rgba(0,0,0,0)');
			g.fillStyle = glow;
			g.fillRect(0, 0, s, s);
			g.globalCompositeOperation = 'destination-in';
			const fade = g.createRadialGradient(c, c, c * 0.35, c, c, c);
			fade.addColorStop(0, 'rgba(0,0,0,1)');
			fade.addColorStop(1, 'rgba(0,0,0,0)');
			g.fillStyle = fade;
			g.fillRect(0, 0, s, s);
		});
	}

	function textTexture(text) {
		const c = document.createElement('canvas');
		c.width = 1024; c.height = 128;
		const t = new T.CanvasTexture(c);
		const draw = () => {
			const g = c.getContext('2d');
			g.clearRect(0, 0, c.width, c.height);
			g.font = '600 62px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
			g.textAlign = 'center';
			g.textBaseline = 'middle';
			g.fillStyle = '#fff';
			g.fillText(text.toUpperCase().split('').join(' '), c.width / 2, c.height / 2);
			t.needsUpdate = true;
		};
		draw();
		if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
		return t;
	}

	function additive(opts) {
		return Object.assign({ transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }, opts);
	}

	class Space3D {

		constructor(container, labelsLayer, catalog, onSelect) {
			this.container = container;
			this.labelsLayer = labelsLayer;
			this.C = catalog;
			this.onSelect = onSelect;
			this.nodes = {};
			this.edges = [];
			this.particles = [];
			this.waves = [];
			this.scheduled = [];
			this.selected = null;
			this.time = 0;
			this.lastInteraction = 0;
			this.statsEl = document.getElementById('hud-stats');
						this.off = new Set();
			this.reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

			this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
			this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			this.renderer.setClearColor(0x02070b, 1);
			container.appendChild(this.renderer.domElement);

			this.scene = new T.Scene();
			this.scene.fog = new T.FogExp2(0x02070b, 0.011);
			this.camera = new T.PerspectiveCamera(42, 1, 0.1, 400);
			this.camera.position.set(0, 50, 62);

			this.controls = new T.OrbitControls(this.camera, this.renderer.domElement);
			this.controls.target.set(0, -2, -1);
			this.controls.enableDamping = true;
			this.controls.dampingFactor = 0.08;
			this.controls.minDistance = 10;
			this.controls.maxDistance = 95;
			this.controls.minPolarAngle = 0.12;
			this.controls.maxPolarAngle = Math.PI * 0.46; //never below the table
			this.controls.autoRotate = false;
			this.controls.autoRotateSpeed = 0.25;
			this.controls.addEventListener('start', () => { this.lastInteraction = this.time; this.controls.autoRotate = false; });

			this.tex = { glow: glowTexture(), ticks: ticksTexture(), arcs: arcsTexture(), brackets: bracketsTexture() };
			this.pos = this.layout();
			this.buildTable();
			this.buildDust();
			this.buildNodes();
			this.buildEdges();
			this.buildParticles();
			this.buildWaves();
			this.bindPicking();
			this.resize();
			window.addEventListener('resize', () => this.resize());
		}

		/* ------------------------------------------------------------ layout */

		/*
		 * Horizontal layout: each column of the catalog becomes a band along x; its nodes are
		 * spread in depth (z), alternately shifted left and right so that links between
		 * neighbours don't overlap. Heights vary slightly, just enough to read the depth.
		 */
		layout() {
			const cols = {};
			this.C.NODES.forEach(n => { (cols[n.col] = cols[n.col] || []).push(n); });
			const pos = {};
			this.bands = [];
			Object.keys(cols).forEach(c => {
				const list = cols[c].sort((a, b) => a.row - b.row);
				const x0 = (c - 2.5) * BAND_GAP;
				list.forEach((n, i) => {
					const z = (i - (list.length - 1) / 2) * ROW_GAP;
					const y = NODE_Y + Math.sin(i * 1.7 + c * 2.3) * 0.7;
					pos[n.id] = new T.Vector3(x0 + (i % 2 ? 1.3 : -1.3), y, z);
				});
				const half = (list.length - 1) / 2 * ROW_GAP;
				this.bands.push({ c: +c, x0, zMin: -half - 2.2, zMax: half + 2.2 });
			});
			return pos;
		}

		/* ------------------------------------------------------------ build */

		buildTable() {
			const floor = new T.Mesh(new T.PlaneGeometry(130, 130), new T.MeshBasicMaterial(additive({ map: floorTexture(), opacity: 0.85, fog: false })));
			floor.rotation.x = -Math.PI / 2;
			floor.position.y = FLOOR_Y;
			this.scene.add(floor);

			//two large reticles turning slowly on the table
			this.tableRings = [];
			[[78, this.tex.ticks, 0.16, 0.02], [58, this.tex.arcs, 0.10, -0.035]].forEach(([size, map, opacity, speed]) => {
				const m = new T.Mesh(new T.PlaneGeometry(size, size), new T.MeshBasicMaterial(additive({ map, color: HOLO, opacity, fog: false })));
				m.rotation.x = -Math.PI / 2;
				m.position.y = FLOOR_Y + 0.02;
				m.userData.speed = speed;
				this.scene.add(m);
				this.tableRings.push(m);
			});

			//one band per area of physiology: corner brackets on the table and its name in front
			this.bands.forEach(b => {
				const x1 = b.x0 - 4.6, x2 = b.x0 + 4.6, z1 = b.zMin, z2 = b.zMax, y = FLOOR_Y + 0.04, l = 1.6;
				const pts = [];
				[[x1, z1, 1, 1], [x2, z1, -1, 1], [x1, z2, 1, -1], [x2, z2, -1, -1]].forEach(([x, z, dx, dz]) => {
					pts.push(new T.Vector3(x, y, z + dz * l), new T.Vector3(x, y, z), new T.Vector3(x, y, z), new T.Vector3(x + dx * l, y, z));
				});
				const brackets = new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial(additive({ color: HOLO, opacity: 0.55 })));
				this.scene.add(brackets);
				const plate = new T.Mesh(new T.PlaneGeometry(x2 - x1, z2 - z1), new T.MeshBasicMaterial(additive({ color: HOLO, opacity: 0.025 })));
				plate.rotation.x = -Math.PI / 2;
				plate.position.set(b.x0, y - 0.01, (z1 + z2) / 2);
				this.scene.add(plate);
				const name = new T.Mesh(new T.PlaneGeometry(8.6, 1.07), new T.MeshBasicMaterial(additive({ map: textTexture(BANDS[b.c] || ''), color: HOLO, opacity: 1 })));
				name.rotation.x = -Math.PI / 2;
				name.position.set(b.x0, y, z2 + 1.3);
				this.scene.add(name);
			});
		}

		buildDust() {
			const n = 700, pos = new Float32Array(n * 3);
			for (let i = 0; i < n; i++) {
				pos[i * 3] = (Math.random() - 0.5) * 150;
				pos[i * 3 + 1] = FLOOR_Y + Math.random() * 40;
				pos[i * 3 + 2] = (Math.random() - 0.5) * 150;
			}
			const geo = new T.BufferGeometry();
			geo.setAttribute('position', new T.BufferAttribute(pos, 3));
			this.dust = new T.Points(geo, new T.PointsMaterial({ color: 0x3f8fae, size: 0.22, transparent: true, opacity: 0.55, depthWrite: false }));
			this.scene.add(this.dust);
		}

		buildNodes() {
			const coreGeo = new T.IcosahedronGeometry(0.4, 1);
			const shellGeo = new T.IcosahedronGeometry(0.72, 0);
			const reticleGeo = new T.PlaneGeometry(2.7, 2.7);
			const arcGeo = new T.PlaneGeometry(2.0, 2.0);
			const hitGeo = new T.SphereGeometry(1.15, 12, 8);
			const hitMat = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
			this.hitMeshes = [];

			this.C.NODES.forEach(n => {
				const p = this.pos[n.id];
				const base = HOLO.clone().lerp(new T.Color(CAT_COLORS[n.cat]), 0.5);
				const g = new T.Group();
				g.position.copy(p);
				this.scene.add(g);

				const core = new T.Mesh(coreGeo, new T.MeshBasicMaterial({ color: base.clone() }));
				g.add(core);
				const shell = new T.Mesh(shellGeo, new T.MeshBasicMaterial(additive({ color: base.clone(), wireframe: true, opacity: 0.55 })));
				g.add(shell);
				const ticks = new T.Mesh(reticleGeo, new T.MeshBasicMaterial(additive({ map: this.tex.ticks, color: base.clone(), opacity: 0.5 })));
				ticks.rotation.x = -Math.PI / 2;
				g.add(ticks);
				const arcs = new T.Mesh(arcGeo, new T.MeshBasicMaterial(additive({ map: this.tex.arcs, color: base.clone(), opacity: 0.6 })));
				arcs.rotation.x = -Math.PI / 2;
				g.add(arcs);
				const halo = new T.Sprite(new T.SpriteMaterial({ map: this.tex.glow, color: base.clone(), transparent: true, opacity: 0.4, blending: T.AdditiveBlending, depthWrite: false }));
				halo.scale.setScalar(2.6);
				g.add(halo);
				const brackets = new T.Mesh(new T.PlaneGeometry(3.4, 3.4), new T.MeshBasicMaterial(additive({ map: this.tex.brackets, color: HOLO, opacity: 0 })));
				this.scene.add(brackets);
				brackets.position.copy(p);

				//projection beam down to the table, with a spot where it lands
				const stem = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(p.x, FLOOR_Y, p.z), new T.Vector3(p.x, p.y - 0.5, p.z)]),
					new T.LineBasicMaterial(additive({ color: base.clone(), opacity: 0.35 })));
				this.scene.add(stem);
				const spot = new T.Mesh(arcGeo, new T.MeshBasicMaterial(additive({ map: this.tex.glow, color: base.clone(), opacity: 0.35 })));
				spot.rotation.x = -Math.PI / 2;
				spot.position.set(p.x, FLOOR_Y + 0.05, p.z);
				spot.scale.setScalar(0.8);
				this.scene.add(spot);

				const hit = new T.Mesh(hitGeo, hitMat);
				hit.position.copy(p);
				hit.userData.id = n.id;
				this.scene.add(hit);
				this.hitMeshes.push(hit);

				const label = document.createElement('div');
				label.className = 'lbl';
				label.innerHTML = '<span class="lbl-name"></span><span class="lbl-val"></span><span class="lbl-f"></span>';
								label.querySelector('.lbl-name').textContent = n.label;
								label.querySelector('.lbl-f').textContent = n.simple || '';
				label.addEventListener('click', () => this.select(n.id, true));
				this.labelsLayer.appendChild(label);

				this.nodes[n.id] = {
					n, pos: p, group: g, core, shell, ticks, arcs, halo, brackets, stem, spot, label, base,
					valEl: label.querySelector('.lbl-val'),
					spin: 0.4 + Math.random() * 0.5, phase: Math.random() * 6.28,
					pulse: 0, trend: 0, activity: 0, last: undefined, offK: 0
				};
			});
		}

		//links arc over the table, higher for longer links
		buildEdges() {
			this.C.NODES.forEach(n => n.in.forEach(([src, sign]) => {
				const a = this.pos[src], b = this.pos[n.id];
				const d = a.distanceTo(b);
				const mid = a.clone().add(b).multiplyScalar(0.5);
				mid.y += 1.4 + d * 0.16;
				if (Math.abs(a.x - b.x) < 3) mid.x += 2.2 + d * 0.08; //same band: bow sideways
				const curve = new T.QuadraticBezierCurve3(a.clone(), mid, b.clone());
				const geo = new T.BufferGeometry().setFromPoints(curve.getPoints(36));
				const baseColor = new T.Color(sign === '-' ? '#7a4a60' : sign === '+' ? '#2d7890' : '#6a6a45');
				const line = new T.Line(geo, new T.LineBasicMaterial(additive({ color: baseColor.clone(), opacity: 0.35 })));
				this.scene.add(line);
				this.edges.push({ src, dst: n.id, sign, curve, line, baseColor, heat: 0, heatColor: NEUTRAL.clone(), lastEmit: 0, live: 1 });
			}));
		}

		buildParticles() {
			const mat = new T.SpriteMaterial({ map: this.tex.glow, color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
			for (let i = 0; i < 420; i++) {
				const s = new T.Sprite(mat.clone());
				s.visible = false;
				s.scale.setScalar(0.8);
				this.scene.add(s);
				this.particles.push({ s, edge: null, t: 0, speed: 0 });
			}
		}

		//expanding rings that mark a node reached by a cascade
		buildWaves() {
			const geo = new T.RingGeometry(0.92, 1, 48);
			for (let i = 0; i < 40; i++) {
				const m = new T.Mesh(geo, new T.MeshBasicMaterial(additive({ color: 0xffffff, opacity: 0 })));
				m.rotation.x = -Math.PI / 2;
				m.visible = false;
				this.scene.add(m);
				this.waves.push({ m, age: -1 });
			}
		}

		/* ------------------------------------------------------------ interaction */

		bindPicking() {
			const ray = new T.Raycaster(), v = new T.Vector2();
			let down = null;
			const el = this.renderer.domElement;
			const pick = e => {
				const r = el.getBoundingClientRect();
				v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
				ray.setFromCamera(v, this.camera);
				return ray.intersectObjects(this.hitMeshes)[0];
			};
			el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
			el.addEventListener('pointerup', e => {
				if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
				down = null;
				const hit = pick(e);
				this.select(hit ? hit.object.userData.id : null, true);
			});
			el.addEventListener('pointermove', e => {
				const hit = pick(e);
				this.hover = hit ? hit.object.userData.id : null;
				el.style.cursor = hit ? 'pointer' : 'grab';
			});
			el.addEventListener('pointerleave', () => { this.hover = null; });
		}

		select(id, notify) {
			this.selected = id;
			for (const k in this.nodes) this.nodes[k].label.classList.toggle('sel', k === id);
			if (id) {
				//move the view halfway toward the node, so the rest of the network stays in sight
				this.focusTarget = this.nodes[id].pos.clone().multiplyScalar(0.5).setY(0);
				this.lastInteraction = this.time;
				this.controls.autoRotate = false;
			}
			if (notify && this.onSelect) this.onSelect(id);
		}

		resize() {
			const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
			this.renderer.setSize(w, h, false);
			this.camera.aspect = w / h;
			//narrow screens: a wider field of view keeps the whole table in sight
			this.camera.fov = w / h < 1 ? 62 : 42;
			this.camera.updateProjectionMatrix();
		}

		/* ------------------------------------------------------------ effects */

		emit(edge, color, speed) {
			const p = this.particles.find(q => !q.edge);
			if (!p) return;
			p.edge = edge;
			p.t = 0;
			p.speed = speed || 0.9;
			p.s.material.color.copy(color);
			p.s.visible = true;
		}

		wave(id, color) {
			const w = this.waves.find(q => q.age < 0);
			if (!w) return;
			w.age = 0;
			w.m.position.copy(this.nodes[id].group.position);
			w.m.material.color.copy(color);
			w.m.visible = true;
		}

		/*
		 * Switched-off nodes turn grey and stop spinning; their links flash grey and fade out, and
		 * no pulse travels through them. Switching back on grows the links again.
		 */
		setOff(ids) {
			const next = new Set(ids);
			for (const id in this.nodes) {
				const was = this.off.has(id), now = next.has(id);
				if (was === now) continue;
				const x = this.nodes[id];
				x.label.classList.toggle('off', now);
				this.wave(id, now ? OFF : HOLO);
				this.wave(id, now ? OFF : HOLO);
				x.pulse = 1;
				x.pulseColor = now ? OFF : HOLO;
				this.edges.forEach(e => {
					if (e.src !== id && e.dst !== id) return;
					e.heat = 1;
					e.heatColor.copy(now ? OFF : HOLO);
				});
			}
			this.off = next;
		}

		isCut(e) { return this.off.has(e.src) || this.off.has(e.dst); }

		//Wave that follows the causal graph from an edited node: green pushes up, red pushes down
		cascade(startId, direction) {
			const seen = { [startId]: direction };
			let frontier = [[startId, direction]];
			this.nodes[startId].pulse = 1;
			this.wave(startId, direction > 0 ? UP : direction < 0 ? DOWN : NEUTRAL);
			for (let depth = 0; depth < 6 && frontier.length; depth++) {
				const next = [];
				frontier.forEach(([id, dir]) => {
					this.edges.filter(e => e.src === id && !this.isCut(e)).forEach(e => {
						const out = e.sign === '+' ? dir : e.sign === '-' ? -dir : 0;
						const delay = depth * 0.42;
						const color = out > 0 ? UP : out < 0 ? DOWN : NEUTRAL;
						for (let k = 0; k < 3; k++) this.scheduled.push({ at: this.time + delay + k * 0.09, edge: e, color });
						this.scheduled.push({ at: this.time + delay + 0.9, pulse: e.dst, color });
						if (!(e.dst in seen) && out !== 0) { seen[e.dst] = out; next.push([e.dst, out]); }
					});
				});
				frontier = next;
			}
		}

		/*
		 * Values from the model. ref: snapshot taken before the last change, used to color
		 * nodes by how far and in which direction they moved. dtSim: simulated seconds elapsed.
		 */
		setValues(o, ref, dtSim, fmt) {
			for (const id in this.nodes) {
				const x = this.nodes[id], n = x.n;
				const v = this.C.nodeValue(n, o);
				x.valEl.textContent = fmt(v, n) + (n.unitFn ? ' ' + n.unitFn(o) : n.unit ? ' ' + n.unit : '');
				if (n.labelFn) x.label.querySelector('.lbl-name').textContent = n.labelFn(o);
				const status = this.C.nodeStatus(n, o);
				x.label.classList.toggle('warn', status === 'warn');
				x.label.classList.toggle('crit', status === 'crit');
				if (ref) {
					const r = this.C.nodeValue(n, ref);
					const rel = (v - r) / (Math.abs(r) + 1e-6);
					x.trend = Math.max(-1, Math.min(1, rel / 0.12));
				}
				x.label.classList.toggle('up', x.trend > 0.15);
				x.label.classList.toggle('down', x.trend < -0.15);
				if (x.last !== undefined && dtSim > 0) {
					const rate = (v - x.last) / (Math.abs(v) + Math.abs(x.last) + 1e-3) * 2 / dtSim;
					x.activity = 0.6 * x.activity + 0.4 * rate;
				}
				x.last = v;
			}
		}

		/* ------------------------------------------------------------ frame */

		frame(dt) {
			this.time += dt;
			const t = this.time;
			const motion = this.reduceMotion ? 0 : 1;

			if (!this.reduceMotion && !this.controls.autoRotate && t - this.lastInteraction > 20) this.controls.autoRotate = true;
			if (this.focusTarget) {
				this.controls.target.lerp(this.focusTarget, Math.min(1, dt * 3));
				if (this.controls.target.distanceTo(this.focusTarget) < 0.05) this.focusTarget = null;
			}
			this.controls.update();

			this.tableRings.forEach(m => { m.rotation.z += m.userData.speed * dt * motion; });
			this.dust.rotation.y += dt * 0.004 * motion;

			//scheduled cascade pulses
			this.scheduled = this.scheduled.filter(s => {
				if (s.at > t) return true;
				if (s.edge) { this.emit(s.edge, s.color, 1.1); s.edge.heat = 1; s.edge.heatColor.copy(s.color); }
				if (s.pulse) { const x = this.nodes[s.pulse]; x.pulse = 1; x.pulseColor = s.color; this.wave(s.pulse, s.color); }
				return false;
			});

			//continuous flow along links whose source is changing
			let flowing = 0;
			this.edges.forEach(e => {
				const cut = this.isCut(e);
				e.live += ((cut ? 0 : 1) - e.live) * Math.min(1, dt * (cut ? 2.2 : 3));
				const a = cut ? 0 : this.nodes[e.src].activity;
				const mag = Math.abs(a);
				if (mag > 0.002 && t - e.lastEmit > Math.max(0.12, 0.6 - mag * 25)) {
					e.lastEmit = t;
					const dir = Math.sign(a) * (e.sign === '+' ? 1 : e.sign === '-' ? -1 : 0);
					this.emit(e, dir > 0 ? UP : dir < 0 ? DOWN : NEUTRAL, 0.55 + Math.min(1, mag * 40));
					e.heat = Math.max(e.heat, Math.min(1, mag * 60));
					e.heatColor.copy(dir > 0 ? UP : dir < 0 ? DOWN : NEUTRAL);
				}
				e.heat = Math.max(0, e.heat - dt * 0.8);
				if (e.heat > 0.1) flowing++;
				const sel = this.selected && (e.src === this.selected || e.dst === this.selected);
				const dim = this.selected && !sel ? 0.45 : 1;
				e.line.material.color.copy(sel ? HOLO : e.baseColor).lerp(e.heatColor, e.heat);
				e.line.material.opacity = (sel ? 0.95 : (0.3 + e.heat * 0.65) * dim) * e.live;
				e.line.visible = e.live > 0.01;
			});

			//particles
			let live = 0;
			this.particles.forEach(p => {
				if (!p.edge) return;
				live++;
				p.t += dt * p.speed;
				if (p.t >= 1) { p.edge = null; p.s.visible = false; return; }
				p.s.position.copy(p.edge.curve.getPoint(p.t));
				const k = Math.sin(p.t * Math.PI);
				p.s.scale.setScalar(0.45 + 0.8 * k);
				p.s.material.opacity = 0.35 + 0.65 * k;
			});

			//shock waves
			this.waves.forEach(w => {
				if (w.age < 0) return;
				w.age += dt;
				const k = w.age / 0.9;
				if (k >= 1) { w.age = -1; w.m.visible = false; return; }
				w.m.scale.setScalar(0.8 + k * 3.2);
				w.m.material.opacity = (1 - k) * 0.9;
			});

			//nodes: base color blended toward green/red by their change since the reference
			const tmp = new T.Color(), white = new T.Color(1, 1, 1);
			for (const id in this.nodes) {
				const x = this.nodes[id];
				const tr = x.trend, sel = id === this.selected, hov = id === this.hover;
				const isOff = this.off.has(id);
				x.offK += ((isOff ? 1 : 0) - x.offK) * Math.min(1, dt * 3);
				tmp.copy(x.base).lerp(tr > 0 ? UP : DOWN, isOff ? 0 : Math.min(1, Math.abs(tr)) * 0.85);
				if (x.pulse > 0.05 && x.pulseColor) tmp.lerp(x.pulseColor, x.pulse * 0.7);
				tmp.lerp(OFF, x.offK);
				x.pulse = Math.max(0, x.pulse - dt * 1.4);
				x.core.material.color.copy(tmp).lerp(white, 0.25 + x.pulse * 0.4);
				[x.shell, x.ticks, x.arcs, x.halo, x.stem, x.spot].forEach(o => o.material.color.copy(tmp));

				const act = Math.min(1, (isOff ? 0 : Math.abs(tr)) + x.pulse);
				const spin = x.spin * (1 + act * 3) * motion * (1 - 0.9 * x.offK);
				x.shell.rotation.y += dt * spin;
				x.shell.rotation.x += dt * spin * 0.4;
				x.ticks.rotation.z += dt * spin * 0.35;
				x.arcs.rotation.z -= dt * spin * 0.9;
				x.group.position.y = x.pos.y + Math.sin(t * 1.3 + x.phase) * 0.12 * motion;
				const s = (1 + x.pulse * 0.5) * (sel ? 1.25 : hov ? 1.12 : 1);
				x.core.scale.setScalar(s);
				x.shell.scale.setScalar(s);
				x.ticks.scale.setScalar(1 + x.pulse * 0.35 + (sel ? 0.25 : 0));
				x.arcs.scale.setScalar(1 + x.pulse * 0.2);
				x.ticks.material.opacity = 0.35 + act * 0.35 + (sel || hov ? 0.3 : 0);
				x.arcs.material.opacity = 0.4 + act * 0.4 + (sel || hov ? 0.3 : 0);
				x.halo.material.opacity = (0.28 + Math.abs(tr) * 0.3 + x.pulse * 0.5) * (1 - 0.7 * x.offK);
				x.halo.scale.setScalar(2.4 + Math.abs(tr) * 1.4 + x.pulse * 2.6);
				x.stem.material.opacity = (0.2 + act * 0.4 + (sel ? 0.4 : 0)) * (1 - 0.6 * x.offK);
				x.spot.material.opacity = 0.25 + act * 0.4 + (sel ? 0.4 : 0);

				x.brackets.material.opacity = sel ? 0.9 : hov ? 0.45 : 0;
				if (sel || hov) {
					x.brackets.position.copy(x.group.position);
					x.brackets.quaternion.copy(this.camera.quaternion);
					x.brackets.scale.setScalar(sel ? 1 + Math.sin(t * 3) * 0.05 : 0.9);
				}
			}

			this.renderer.render(this.scene, this.camera);
			this.placeLabels();

			if (this.statsEl && (!this.statsAt || t - this.statsAt > 0.5)) {
				this.statsAt = t;
				this.statsEl.textContent = 'NODI ' + this.C.NODES.length + ' · LINK ' + this.edges.length + ' · IN FLUSSO ' + String(flowing).padStart(2, '0') + ' · IMPULSI ' + String(live).padStart(3, '0');
			}
		}

		/*
		 * Labels sit to the right of their node, joined by a short leader line. They are
		 * decluttered: the most relevant ones are placed first (selected node, its neighbours,
		 * nodes that are changing, nodes close to the camera) and a label that would overlap
		 * one already placed is hidden.
		 */
		placeLabels() {
			const w = this.container.clientWidth, h = this.container.clientHeight;
			const v = new T.Vector3();
			const camPos = this.camera.position;
			const neighbours = new Set();
			if (this.selected) this.edges.forEach(e => {
				if (e.src === this.selected) neighbours.add(e.dst);
				if (e.dst === this.selected) neighbours.add(e.src);
			});
			if (!this.sizeAt || this.time - this.sizeAt > 2) {
				this.sizeAt = this.time;
				for (const id in this.nodes) {
					const x = this.nodes[id];
					x.lw = x.label.offsetWidth || 90;
					x.lh = x.label.offsetHeight || 28;
				}
			}
			const cands = [];
			for (const id in this.nodes) {
				const x = this.nodes[id];
				v.copy(x.group.position).project(this.camera);
				if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { x.label.style.display = 'none'; continue; }
				const dist = camPos.distanceTo(x.group.position);
				const near = Math.max(0, Math.min(1, (85 - dist) / 50));
				const pri = (id === this.selected ? 1000 : 0) + (id === this.hover ? 800 : 0) + (neighbours.has(id) ? 500 : 0) + Math.abs(x.trend) * 150 + x.pulse * 150 + near * 100;
				cands.push({ id, x, sx: (v.x + 1) / 2 * w, sy: (1 - v.y) / 2 * h, near, pri, scale: 0.8 + near * 0.25 });
			}
			cands.sort((a, b) => b.pri - a.pri);
			const placed = [];
			cands.forEach(c => {
				const lw = c.x.lw * c.scale, lh = c.x.lh * c.scale;
				const r = { l: c.sx + 8, r: c.sx + 14 + lw, t: c.sy - lh / 2 - 1, b: c.sy + lh / 2 + 1 };
				const clash = placed.some(p => r.l < p.r && r.r > p.l && r.t < p.b && r.b > p.t);
				if (clash && c.pri < 500) { c.x.label.style.display = 'none'; return; }
				placed.push(r);
				c.x.label.style.display = '';
				c.x.label.style.transform = 'translate(' + (c.sx + 12).toFixed(1) + 'px,' + c.sy.toFixed(1) + 'px) translateY(-50%) scale(' + c.scale.toFixed(3) + ')';
				c.x.label.style.opacity = c.id === this.selected || neighbours.has(c.id) || c.id === this.hover ? 1 : (0.5 + c.near * 0.5).toFixed(2);
				c.x.label.style.zIndex = String(Math.round(c.pri));
			});
		}
	}

	global.Space3D = Space3D;
	global.Space3DColors = CAT_COLORS;
})(window);
