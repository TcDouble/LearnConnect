// confirm-dialog.js — a shared Yes/No confirmation dialog.
//
// The native confirm() only ever offers "OK"/"Cancel", which reads badly for
// questions like "Cancel this session?" (cancelling the dialog and cancelling
// the session are two different things). This replaces it with an in-page
// modal whose answers are plainly "Yes" and "No".
//
// Usage:  if (!await confirmYesNo('Cancel this session?')) return;
// Options: { title, yesText, noText, danger }  — danger (default true) paints
// the Yes button red for destructive actions.
(function () {
    const STYLE_ID = 'lc-confirm-style';
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
.lc-confirm-overlay { position: fixed; inset: 0; background: rgba(15,59,44,0.45); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 1000; }
.lc-confirm-box { background: white; border-radius: 20px; width: min(400px, 100%); padding: 24px; box-shadow: 0 24px 64px rgba(15,59,44,0.24); text-align: center; font-family: inherit; }
.lc-confirm-title { font-size: 1.05rem; font-weight: 700; color: #0f3b2c; margin-bottom: 8px; }
.lc-confirm-msg { font-size: 0.92rem; color: #334155; line-height: 1.5; }
.lc-confirm-actions { display: flex; gap: 10px; margin-top: 20px; }
.lc-confirm-btn { flex: 1; padding: 10px 16px; border-radius: 40px; font-size: 0.9rem; font-weight: 600; font-family: inherit; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.lc-confirm-no { background: white; color: #334155; border: 1px solid #e2e8f0; }
.lc-confirm-no:hover { background: #f8fafc; }
.lc-confirm-yes { border: none; background: #2b7a4b; color: white; }
.lc-confirm-yes:hover { background: #235f3b; }
.lc-confirm-yes.danger { background: #dc2626; }
.lc-confirm-yes.danger:hover { background: #b91c1c; }`;
        document.head.appendChild(style);
    }

    window.confirmYesNo = function (message, opts = {}) {
        const { title = '', yesText = 'Yes', noText = 'No', danger = true } = opts;

        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'lc-confirm-overlay';
            const box = document.createElement('div');
            box.className = 'lc-confirm-box';
            box.setAttribute('role', 'alertdialog');
            box.setAttribute('aria-modal', 'true');
            box.innerHTML = `${title ? `<div class="lc-confirm-title"></div>` : ''}<div class="lc-confirm-msg"></div>
                <div class="lc-confirm-actions">
                    <button type="button" class="lc-confirm-btn lc-confirm-no"></button>
                    <button type="button" class="lc-confirm-btn lc-confirm-yes${danger ? ' danger' : ''}"></button>
                </div>`;
            // textContent, not innerHTML — messages interpolate user-supplied
            // names and subjects.
            if (title) box.querySelector('.lc-confirm-title').textContent = title;
            box.querySelector('.lc-confirm-msg').textContent = message;
            const noBtn = box.querySelector('.lc-confirm-no');
            const yesBtn = box.querySelector('.lc-confirm-yes');
            noBtn.textContent = noText;
            yesBtn.textContent = yesText;
            overlay.appendChild(box);

            const prevFocus = document.activeElement;
            function close(answer) {
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                if (prevFocus && prevFocus.focus) prevFocus.focus();
                resolve(answer);
            }
            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); close(false); }
                else if (e.key === 'Enter' && document.activeElement === noBtn) { e.preventDefault(); close(false); }
            }

            noBtn.addEventListener('click', () => close(false));
            yesBtn.addEventListener('click', () => close(true));
            // Clicking the backdrop is a "no" — the safe answer for a
            // destructive prompt.
            overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
            document.addEventListener('keydown', onKey, true);

            document.body.appendChild(overlay);
            noBtn.focus();
        });
    };
})();
