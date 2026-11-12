// Keyboard / mouse / pointer-lock / touch input
export const DEFAULT_BINDS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC', 'ControlLeft'], reload: ['KeyR'], interact: ['KeyE'],
  grenade: ['KeyG'], melee: ['KeyF', 'KeyV'], focus: ['KeyQ'], fire: ['Mouse0'], ads: ['Mouse2'], pause: ['KeyP', 'Escape'], next: ['KeyX'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas; this.down = new Set(); this.edge = new Set(); this.dx = 0; this.dy = 0; this.wheel = 0; this.locked = false; this.enabled = false;
    this.binds = DEFAULT_BINDS; this.touch = false; this.stick = { x: 0, y: 0 }; this.slot = 0; this.onLockChange = null; this.onFirstGesture = null;
    this.sens = 1; this.invertY = false;
    const block = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'KeyF', 'Slash', 'Quote']);
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if ((block.has(e.code) || this.locked) && !(e.code === 'F5' || e.code === 'F11' || e.code === 'F12')) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code); this.edge.add(e.code);
      if (e.code.startsWith('Digit')) this.slot = +e.code.slice(5);
      this._gesture();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); });
    canvas.addEventListener('mousedown', (e) => { this.down.add('Mouse' + e.button); this.edge.add('Mouse' + e.button); this._gesture(); if (this.enabled && !this.locked && !this.touch) this.lock(); e.preventDefault(); });
    addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    addEventListener('mousemove', (e) => { if (this.locked) { let mx = e.movementX || 0, my = e.movementY || 0; if (Math.abs(mx) > 400 || Math.abs(my) > 400) return; this.dx += mx; this.dy += my; } });
    addEventListener('wheel', (e) => { if (this.locked) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (!this.locked) this.down.clear(); if (this.onLockChange) this.onLockChange(this.locked); });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
  }
  _gesture() { if (this.onFirstGesture) { const f = this.onFirstGesture; this.onFirstGesture = null; f(); } }
  lock() { if (this.touch) return; try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => { }); } catch (e) { } }); } catch (e) { try { this.canvas.requestPointerLock(); } catch (e2) { } } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  is(action) { const b = this.binds[action]; for (let i = 0; i < b.length; i++) if (this.down.has(b[i])) return true; return this.down.has('T_' + action); }
  hit(action) { const b = this.binds[action]; for (let i = 0; i < b.length; i++) if (this.edge.has(b[i])) return true; return this.edge.has('T_' + action); }
  endFrame() { this.edge.clear(); this.dx = 0; this.dy = 0; this.wheel = 0; this.slot = 0; }

  // ---- touch controls ----
  setupTouch(root) {
    this.touch = true; root.classList.add('on'); document.body.classList.add('touch');
    const stickEl = root.querySelector('.stick'), knob = root.querySelector('.knob'), look = root.querySelector('.look');
    let sid = null, sx = 0, sy = 0, lid = null, lx = 0, ly = 0;
    const R = 56;
    stickEl.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sid = t.identifier; const r = stickEl.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; this._gesture(); e.preventDefault(); }, { passive: false });
    const lookStart = (e) => { for (const t of e.changedTouches) { if (lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } } this._gesture(); };
    look.addEventListener('touchstart', (e) => { lookStart(e); e.preventDefault(); }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) { let dx = t.clientX - sx, dy = t.clientY - sy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } this.stick.x = dx / R; this.stick.y = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`; }
        else if (t.identifier === lid) { this.dx += (t.clientX - lx) * 2.6; this.dy += (t.clientY - ly) * 2.6; lx = t.clientX; ly = t.clientY; }
      }
      if (this.enabled) e.preventDefault();
    }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) { if (t.identifier === sid) { sid = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; } if (t.identifier === lid) lid = null; } };
    addEventListener('touchend', end); addEventListener('touchcancel', end);
    root.querySelectorAll('[data-act]').forEach((el) => {
      const act = 'T_' + el.dataset.act, toggle = el.dataset.toggle;
      el.addEventListener('touchstart', (e) => {
        if (toggle) { if (this.down.has(act)) this.down.delete(act); else this.down.add(act); el.classList.toggle('held', this.down.has(act)); }
        else { this.down.add(act); el.classList.add('held'); }
        this.edge.add(act);
        if (el.dataset.look) lookStart(e);
        this._gesture(); e.preventDefault(); e.stopPropagation();
      }, { passive: false });
      const up = (e) => { if (!toggle) { this.down.delete(act); el.classList.remove('held'); } e.preventDefault(); };
      el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    });
  }
}
