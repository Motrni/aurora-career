/**
 * settings-tour.js — Lightweight guided tour engine for Aurora Career settings.
 * Two modes: 'onboarding' (mandatory, no close) and 'help' (dismissable).
 * No external dependencies.
 */

class SettingsTour {
    constructor(steps, options = {}) {
        this.steps = steps || [];
        this.mode = options.mode || 'help';
        this.onComplete = options.onComplete || null;
        this.currentIdx = 0;
        this.overlay = null;
        this.spotlight = null;
        this.popover = null;
        this._resizeHandler = null;
    }

    start() {
        if (!this.steps.length) return;
        this.currentIdx = 0;
        this._injectCSS();
        this._createOverlay();
        this._showStep(0);
        this._resizeHandler = () => this._repositionCurrent();
        window.addEventListener('resize', this._resizeHandler);
    }

    next() {
        if (this.currentIdx < this.steps.length - 1) {
            this.currentIdx++;
            this._showStep(this.currentIdx);
        } else {
            this.destroy();
            if (this.onComplete) this.onComplete();
        }
    }

    close() {
        if (this.mode === 'help') {
            this.destroy();
        }
    }

    destroy() {
        if (this.overlay) { this.overlay.remove(); this.overlay = null; }
        if (this.spotlight) { this.spotlight.remove(); this.spotlight = null; }
        if (this.popover) { this.popover.remove(); this.popover = null; }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
    }

    _injectCSS() {
        if (document.getElementById('tour-engine-css')) return;
        const style = document.createElement('style');
        style.id = 'tour-engine-css';
        style.textContent = `
            .tour-overlay {
                position: fixed; inset: 0; z-index: 9997;
                background: rgba(0,0,0,0.6);
                transition: opacity 0.3s ease;
            }
            .tour-spotlight {
                position: absolute; z-index: 9998;
                border-radius: 12px;
                box-shadow: 0 0 0 9999px rgba(0,0,0,0.65);
                pointer-events: none;
                transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .tour-popover {
                position: absolute; z-index: 9999;
                width: 340px; max-width: calc(100vw - 32px);
                background: rgba(33, 30, 41, 0.97);
                backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
                border: 1px solid rgba(204, 190, 255, 0.12);
                border-radius: 16px;
                padding: 20px 22px;
                box-shadow: 0 20px 50px rgba(0,0,0,0.4);
                animation: tourPopIn 0.25s ease-out;
                font-family: 'Inter', system-ui, sans-serif;
            }
            @keyframes tourPopIn {
                from { opacity: 0; transform: translateY(8px) scale(0.96); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .tour-popover-title {
                font-size: 16px; font-weight: 700; color: #e7e0ef;
                margin-bottom: 8px; line-height: 1.3;
            }
            .tour-popover-desc {
                font-size: 13px; color: #cac3d7; line-height: 1.55;
                margin-bottom: 16px;
            }
            .tour-popover-footer {
                display: flex; align-items: center; justify-content: space-between;
            }
            .tour-popover-progress {
                font-size: 11px; color: #938ea0; font-weight: 600;
                letter-spacing: 0.05em;
            }
            .tour-btn-next {
                background: linear-gradient(to right, #5a30d0, #58309f);
                color: #fff; border: none; border-radius: 10px;
                padding: 10px 22px; font-size: 13px; font-weight: 700;
                cursor: pointer; transition: filter 0.2s, transform 0.1s;
                font-family: inherit;
            }
            .tour-btn-next:hover { filter: brightness(1.12); }
            .tour-btn-next:active { transform: scale(0.97); }
            .tour-btn-close {
                position: absolute; top: 12px; right: 12px;
                background: none; border: none; color: #938ea0;
                cursor: pointer; font-size: 20px; line-height: 1;
                padding: 4px; border-radius: 6px; transition: color 0.2s;
                font-family: 'Material Symbols Outlined';
            }
            .tour-btn-close:hover { color: #e7e0ef; }
        `;
        document.head.appendChild(style);
    }

    _createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'tour-overlay';
        document.body.appendChild(this.overlay);

        this.spotlight = document.createElement('div');
        this.spotlight.className = 'tour-spotlight';
        document.body.appendChild(this.spotlight);

        this.popover = document.createElement('div');
        this.popover.className = 'tour-popover';
        document.body.appendChild(this.popover);
    }

    async _showStep(idx) {
        const step = this.steps[idx];
        if (!step) return;

        if (step.onBeforeShow) {
            step.onBeforeShow();
            await this._delay(350);
        }

        const el = document.querySelector(step.selector);
        if (!el) {
            this.next();
            return;
        }

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await this._delay(350);

        this._positionSpotlight(el);
        this._renderPopover(step, el, idx);
    }

    _positionSpotlight(el) {
        const rect = el.getBoundingClientRect();
        const pad = 8;
        this.spotlight.style.top = (rect.top + window.scrollY - pad) + 'px';
        this.spotlight.style.left = (rect.left + window.scrollX - pad) + 'px';
        this.spotlight.style.width = (rect.width + pad * 2) + 'px';
        this.spotlight.style.height = (rect.height + pad * 2) + 'px';
    }

    _renderPopover(step, el, idx) {
        const rect = el.getBoundingClientRect();
        const side = step.side || 'bottom';

        let closeBtn = '';
        if (this.mode === 'help') {
            closeBtn = '<button class="tour-btn-close" onclick="this.closest(\'.tour-popover\').__tourClose()">close</button>';
        }

        this.popover.innerHTML = `
            ${closeBtn}
            <div class="tour-popover-title">${step.title}</div>
            <div class="tour-popover-desc">${step.description}</div>
            <div class="tour-popover-footer">
                <span class="tour-popover-progress">${idx + 1} / ${this.steps.length}</span>
                <button class="tour-btn-next" id="tourNextBtn">${idx === this.steps.length - 1 ? 'Готово' : 'Далее'}</button>
            </div>
        `;

        this.popover.__tourClose = () => this.close();
        document.getElementById('tourNextBtn').addEventListener('click', () => this.next());

        const popW = 340;
        const popH = this.popover.offsetHeight || 180;
        let top, left;

        if (side === 'top') {
            top = rect.top + window.scrollY - popH - 16;
            left = rect.left + window.scrollX + rect.width / 2 - popW / 2;
        } else {
            top = rect.bottom + window.scrollY + 16;
            left = rect.left + window.scrollX + rect.width / 2 - popW / 2;
        }

        const vw = window.innerWidth;
        if (left < 16) left = 16;
        if (left + popW > vw - 16) left = vw - popW - 16;
        if (top < 0) top = rect.bottom + window.scrollY + 16;

        this.popover.style.top = top + 'px';
        this.popover.style.left = left + 'px';

        this.popover.style.animation = 'none';
        void this.popover.offsetWidth;
        this.popover.style.animation = '';
    }

    _repositionCurrent() {
        const step = this.steps[this.currentIdx];
        if (!step) return;
        const el = document.querySelector(step.selector);
        if (!el) return;
        this._positionSpotlight(el);
        this._renderPopover(step, el, this.currentIdx);
    }

    _delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

window.SettingsTour = SettingsTour;
