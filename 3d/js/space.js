/*
 * NodeSim 3D - the virtual space
 *
 * Nodes are glowing spheres laid out in layers (one layer per area of physiology),
 * like a neural network. Links are curves; pulses of light travel along them:
 * green when the change pushes the target node up, red when it pushes it down.
 * Node labels are HTML elements projected on top of the WebGL canvas.
 */
(function (global) {
	'use strict';

	const T = global.THREE;
	const UP = new T.Color('#3ee08f'), DOWN = new T.Color('#ff5b6b'), NEUTRAL = new T.Color('#9fb6c4');
	const CAT_COLORS = { vent: '#4fd4ef', pat: '#d2bb8c', mech: '#a88cff', gas: '#4be0a0', hemo: '#ff6b82', o2: '#ffb14a' };
	const LAYER_GAP = 9.5, RADIUS_Y = 7, RADIUS_Z = 5;

	function glowTexture() {
		const c = document.createElement('canvas');
		c.width = c.height = 128;
		const g = c.getContext('2d');
		const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
		grd.addColorStop(0, 'rgba(255,255,255,1)');
		grd.addColorStop(0.2, 'rgba(255,255,255,0.65)');
		grd.addColorStop(0.5, 'rgba(255,255,255,0.15)');
		grd.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = grd;
		g.fillRect(0, 0, 128, 128);
		const t = new T.CanvasTexture(c);
		return t;
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
			this.scheduled = [];
			this.selected = null;
			this.time = 0;
			this.lastInteraction = -99;
			this.reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

			this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
			this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
			this.renderer.setClearColor(0x05090d, 1);
			container.appendChild(this.renderer.domElement);

			this.scene = new T.Scene();
			this.scene.fog = new T.FogExp2(0x05090d, 0.013);
			this.camera = new T.PerspectiveCamera(50, 1, 0.1, 400);
			this.camera.position.set(-6, 11, 56);

			this.controls = new T.OrbitControls(this.camera, this.renderer.domElement);
			this.controls.enableDamping = true;
			this.controls.dampingFactor = 0.08;
			this.controls.minDistance = 8;
			this.controls.maxDistance = 90;
			this.controls.autoRotate = !this.reduceMotion;
			this.controls.autoRotateSpeed = 0.35;
			this.controls.addEventListener('start', () => { this.lastInteraction = this.time; this.controls.autoRotate = false; });

			this.scene.add(new T.AmbientLight(0xffffff, 0.45));
			const key = new T.PointLight(0xbfe9ff, 1.1, 200);
			key.position.set(20, 30, 40);
			this.scene.add(key);
			const rim = new T.PointLight(0xff9fb0, 0.6, 200);
			rim.position.set(-30, -20, -30);
			this.scene.add(rim);

			this.glow = glowTexture();
			this.buildStars();
			this.buildNodes();
			this.buildEdges();
			this.buildParticles();
			this.bindPicking();
			this.resize();
			window.addEventListener('resize', () => this.resize());
		}

		/* ------------------------------------------------------------ build */

		buildStars() {
			const n = 1400, pos = new Float32Array(n * 3);
			for (let i = 0; i < n; i++) {
				const r = 70 + Math.random() * 90, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
				pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
				pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
				pos[i * 3 + 2] = r * Math.cos(ph);
			}
			const geo = new T.BufferGeometry();
			geo.setAttribute('position', new T.BufferAttribute(pos, 3));
			this.scene.add(new T.Points(geo, new T.PointsMaterial({ color: 0x5f7a8c, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.7, fog: false })));
		}

		layout() {
			const cols = {};
			this.C.NODES.forEach(n => { (cols[n.col] = cols[n.col] || []).push(n); });
			const pos = {};
			Object.keys(cols).forEach(c => {
				const list = cols[c].sort((a, b) => a.row - b.row);
				list.forEach((n, i) => {
					const a = (i / list.length) * Math.PI * 2 + c * 0.45;
					pos[n.id] = new T.Vector3((c - 2.5) * LAYER_GAP + Math.sin(a * 2) * 0.8, Math.cos(a) * RADIUS_Y, Math.sin(a) * RADIUS_Z);
				});
			});
			return pos;
		}

		buildNodes() {
			const pos = this.layout();
			const geo = new T.SphereGeometry(0.62, 28, 18);
			const ringGeo = new T.RingGeometry(1.05, 1.22, 48);
			this.C.NODES.forEach(n => {
				const color = new T.Color(CAT_COLORS[n.cat]);
				const mat = new T.MeshStandardMaterial({ color, emissive: color.clone(), emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.15 });
				const mesh = new T.Mesh(geo, mat);
				mesh.position.copy(pos[n.id]);
				mesh.userData.id = n.id;
				this.scene.add(mesh);
				const halo = new T.Sprite(new T.SpriteMaterial({ map: this.glow, color: color.clone(), transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
				halo.scale.setScalar(3.2);
				halo.position.copy(mesh.position);
				this.scene.add(halo);
				const ring = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false }));
				ring.position.copy(mesh.position);
				this.scene.add(ring);

				const label = document.createElement('div');
				label.className = 'lbl';
				label.innerHTML = '<span class="lbl-name"></span><span class="lbl-val"></span>';
				label.querySelector('.lbl-name').textContent = n.label;
				label.addEventListener('click', () => this.select(n.id, true));
				this.labelsLayer.appendChild(label);

				this.nodes[n.id] = {
					n, mesh, halo, ring, label, base: color,
					valEl: label.querySelector('.lbl-val'),
					pulse: 0, trend: 0, trendColor: NEUTRAL.clone(), activity: 0, last: undefined
				};
			});
		}

		buildEdges() {
			this.C.NODES.forEach(n => n.in.forEach(([src, sign]) => {
				const a = this.nodes[src].mesh.position, b = this.nodes[n.id].mesh.position;
				const mid = a.clone().add(b).multiplyScalar(0.5);
				const out = new T.Vector3(0, mid.y, mid.z);
				if (out.length() < 0.1) out.set(0, 1, 0);
				out.normalize().multiplyScalar(2.2 + a.distanceTo(b) * 0.12);
				if (Math.abs(a.x - b.x) < 1) out.x += 4; // same layer: bend outwards
				const curve = new T.QuadraticBezierCurve3(a.clone(), mid.add(out), b.clone());
				const geo = new T.BufferGeometry().setFromPoints(curve.getPoints(30));
				const baseColor = new T.Color(sign === '-' ? '#6a3b47' : sign === '+' ? '#2f5a6a' : '#5a5635');
				const mat = new T.LineBasicMaterial({ color: baseColor.clone(), transparent: true, opacity: 0.32, depthWrite: false });
				const line = new T.Line(geo, mat);
				this.scene.add(line);
				this.edges.push({ src, dst: n.id, sign, curve, line, baseColor, heat: 0, heatColor: NEUTRAL.clone(), lastEmit: 0 });
			}));
		}

		buildParticles() {
			const mat = new T.SpriteMaterial({ map: this.glow, color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
			for (let i = 0; i < 420; i++) {
				const s = new T.Sprite(mat.clone());
				s.visible = false;
				s.scale.setScalar(0.9);
				this.scene.add(s);
				this.particles.push({ s, edge: null, t: 0, speed: 0 });
			}
		}

		/* ------------------------------------------------------------ interaction */

		bindPicking() {
			const ray = new T.Raycaster(), v = new T.Vector2();
			let down = null;
			const el = this.renderer.domElement;
			el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
			el.addEventListener('pointerup', e => {
				if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
				down = null;
				const r = el.getBoundingClientRect();
				v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
				ray.setFromCamera(v, this.camera);
				const hit = ray.intersectObjects(Object.values(this.nodes).map(x => x.mesh))[0];
				this.select(hit ? hit.object.userData.id : null, true);
			});
			el.addEventListener('pointermove', e => {
				const r = el.getBoundingClientRect();
				v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
				ray.setFromCamera(v, this.camera);
				el.style.cursor = ray.intersectObjects(Object.values(this.nodes).map(x => x.mesh)).length ? 'pointer' : 'grab';
			});
		}

		select(id, notify) {
			this.selected = id;
			for (const k in this.nodes) this.nodes[k].label.classList.toggle('sel', k === id);
			if (id) {
				//move the view halfway toward the node, so the rest of the network stays in sight
				this.focusTarget = this.nodes[id].mesh.position.clone().multiplyScalar(0.5);
				this.lastInteraction = this.time;
				this.controls.autoRotate = false;
			}
			if (notify && this.onSelect) this.onSelect(id);
		}

		resize() {
			const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
			this.renderer.setSize(w, h, false);
			this.camera.aspect = w / h;
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

		//Wave that follows the causal graph from an edited node: green pushes up, red pushes down
		cascade(startId, direction) {
			const seen = { [startId]: direction };
			let frontier = [[startId, direction]];
			this.nodes[startId].pulse = 1;
			for (let depth = 0; depth < 6 && frontier.length; depth++) {
				const next = [];
				frontier.forEach(([id, dir]) => {
					this.edges.filter(e => e.src === id).forEach(e => {
						const out = e.sign === '+' ? dir : e.sign === '-' ? -dir : 0;
						const delay = depth * 0.42;
						for (let k = 0; k < 3; k++) this.scheduled.push({ at: this.time + delay + k * 0.09, edge: e, color: out > 0 ? UP : out < 0 ? DOWN : NEUTRAL });
						this.scheduled.push({ at: this.time + delay + 0.9, pulse: e.dst, color: out > 0 ? UP : out < 0 ? DOWN : NEUTRAL });
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

			if (!this.reduceMotion && !this.controls.autoRotate && t - this.lastInteraction > 14) this.controls.autoRotate = true;
			if (this.focusTarget) {
				this.controls.target.lerp(this.focusTarget, Math.min(1, dt * 3));
				if (this.controls.target.distanceTo(this.focusTarget) < 0.05) this.focusTarget = null;
			}
			this.controls.update();

			//scheduled cascade pulses
			this.scheduled = this.scheduled.filter(s => {
				if (s.at > t) return true;
				if (s.edge) { this.emit(s.edge, s.color, 1.1); s.edge.heat = 1; s.edge.heatColor.copy(s.color); }
				if (s.pulse) { const x = this.nodes[s.pulse]; x.pulse = 1; x.pulseColor = s.color; }
				return false;
			});

			//continuous flow along links whose source is changing
			this.edges.forEach(e => {
				const a = this.nodes[e.src].activity;
				const mag = Math.abs(a);
				if (mag > 0.002 && t - e.lastEmit > Math.max(0.12, 0.6 - mag * 25)) {
					e.lastEmit = t;
					const dir = Math.sign(a) * (e.sign === '+' ? 1 : e.sign === '-' ? -1 : 0);
					this.emit(e, dir > 0 ? UP : dir < 0 ? DOWN : NEUTRAL, 0.55 + Math.min(1, mag * 40));
					e.heat = Math.max(e.heat, Math.min(1, mag * 60));
					e.heatColor.copy(dir > 0 ? UP : dir < 0 ? DOWN : NEUTRAL);
				}
				e.heat = Math.max(0, e.heat - dt * 0.8);
				const sel = this.selected && (e.src === this.selected || e.dst === this.selected);
				e.line.material.color.copy(e.baseColor).lerp(e.heatColor, e.heat);
				e.line.material.opacity = sel ? 0.9 : 0.25 + e.heat * 0.6;
			});

			//particles
			this.particles.forEach(p => {
				if (!p.edge) return;
				p.t += dt * p.speed;
				if (p.t >= 1) { p.edge = null; p.s.visible = false; return; }
				p.s.position.copy(p.edge.curve.getPoint(p.t));
				const k = Math.sin(p.t * Math.PI);
				p.s.scale.setScalar(0.5 + 0.9 * k);
				p.s.material.opacity = 0.35 + 0.65 * k;
			});

			//nodes: base color blended toward green/red by their change since the reference
			const tmp = new T.Color();
			for (const id in this.nodes) {
				const x = this.nodes[id];
				const tr = x.trend;
				tmp.copy(x.base).lerp(tr > 0 ? UP : DOWN, Math.min(1, Math.abs(tr)) * 0.85);
				x.mesh.material.color.copy(tmp);
				x.mesh.material.emissive.copy(tmp);
				x.pulse = Math.max(0, x.pulse - dt * 1.4);
				const breathe = 1 + Math.sin(t * 2 + x.mesh.position.x) * 0.03;
				x.mesh.scale.setScalar((1 + x.pulse * 0.6) * breathe);
				x.mesh.material.emissiveIntensity = 0.4 + Math.abs(tr) * 0.5 + x.pulse * 0.9;
				x.halo.material.color.copy(x.pulse > 0.05 && x.pulseColor ? tmp.clone().lerp(x.pulseColor, x.pulse) : tmp);
				x.halo.material.opacity = 0.35 + Math.abs(tr) * 0.35 + x.pulse * 0.5;
				x.halo.scale.setScalar(3 + Math.abs(tr) * 1.6 + x.pulse * 3);
				x.ring.material.opacity = id === this.selected ? 0.85 : 0;
				if (id === this.selected) {
					x.ring.quaternion.copy(this.camera.quaternion);
					x.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
				}
			}

			this.renderer.render(this.scene, this.camera);
			this.placeLabels();
		}

		/*
		 * Labels are decluttered: the most relevant ones are placed first (selected node, its
		 * neighbours, nodes that are changing, nodes close to the camera) and a label that
		 * would overlap one already placed is hidden.
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
				v.copy(x.mesh.position).project(this.camera);
				if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { x.label.style.display = 'none'; continue; }
				const dist = camPos.distanceTo(x.mesh.position);
				const near = Math.max(0, Math.min(1, (80 - dist) / 50));
				const pri = (id === this.selected ? 1000 : 0) + (neighbours.has(id) ? 500 : 0) + Math.abs(x.trend) * 150 + x.pulse * 150 + near * 100;
				cands.push({ id, x, sx: (v.x + 1) / 2 * w, sy: (1 - v.y) / 2 * h + 14, dist, near, pri, scale: 0.74 + near * 0.3 });
			}
			cands.sort((a, b) => b.pri - a.pri);
			const placed = [];
			cands.forEach(c => {
				const lw = c.x.lw * c.scale, lh = c.x.lh * c.scale;
				const r = { l: c.sx - lw / 2 - 2, r: c.sx + lw / 2 + 2, t: c.sy - 1, b: c.sy + lh + 1 };
				const clash = placed.some(p => r.l < p.r && r.r > p.l && r.t < p.b && r.b > p.t);
				if (clash && c.pri < 500) { c.x.label.style.display = 'none'; return; }
				placed.push(r);
				c.x.label.style.display = '';
				c.x.label.style.transform = 'translate(' + c.sx.toFixed(1) + 'px,' + c.sy.toFixed(1) + 'px) translateX(-50%) scale(' + c.scale.toFixed(3) + ')';
				c.x.label.style.opacity = c.id === this.selected || neighbours.has(c.id) ? 1 : (0.45 + c.near * 0.55).toFixed(2);
				c.x.label.style.zIndex = String(Math.round(c.pri));
			});
		}
	}

	global.Space3D = Space3D;
	global.Space3DColors = CAT_COLORS;
})(window);
