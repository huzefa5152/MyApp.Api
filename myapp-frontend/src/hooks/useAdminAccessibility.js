import { useEffect } from "react";

const focusable = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
const visible = (element) => element.getClientRects().length && !element.closest('[inert], [aria-hidden="true"]');

// Presentation-only enhancement of explicitly marked admin surfaces, including portals.
export default function useAdminAccessibility() {
  useEffect(() => {
    const dialogs = new Map();
    let sequence = 0;
    let scheduled = 0;
    let savedOverflow;
    const topDialog = () => [...dialogs.keys()].filter(el => el.isConnected && visible(el))
      .sort((a, b) => Number(getComputedStyle(a.closest('[data-admin-backdrop]') || a).zIndex) - Number(getComputedStyle(b.closest('[data-admin-backdrop]') || b).zIndex)).at(-1);
    const scan = () => {
      scheduled = 0;
      if (!document.body.classList.contains('admin-ui')) return;
      for (const [dialog, previous] of dialogs) {
        if (dialog.isConnected) continue;
        dialogs.delete(dialog);
        if (previous?.isConnected && (!topDialog() || topDialog().contains(previous))) previous.focus({ preventScroll: true });
      }
      document.querySelectorAll('[data-admin-dialog]').forEach(dialog => {
        if (dialogs.has(dialog) || !visible(dialog) || dialog.classList.contains('ui-client-modal')) return;
        const previous = document.activeElement;
        dialogs.set(dialog, previous);
        if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
          const title = dialog.querySelector('h1,h2,h3,h4,h5,h6');
          if (title) {
            if (!title.id) title.id = `admin-dialog-title-${++sequence}`;
            dialog.setAttribute('aria-labelledby', title.id);
          } else dialog.setAttribute('aria-label', 'Details');
        }
        dialog.tabIndex = -1;
        dialog.querySelectorAll('[data-admin-close]').forEach(button => {
          if (!button.hasAttribute('aria-label') && /^[×✕✖x\s]*$/.test(button.textContent)) button.setAttribute('aria-label', 'Close dialog');
        });
        if (!dialog.contains(document.activeElement)) {
          const target = dialog.querySelector('[autofocus]') || [...dialog.querySelectorAll(focusable)].find(visible) || dialog;
          target.focus({ preventScroll: true });
        }
      });
      document.querySelectorAll('[data-admin-table-region]').forEach(region => {
        region.setAttribute('role', 'region');
        if (!region.hasAttribute('aria-label')) region.setAttribute('aria-label', 'Scrollable table');
        region.tabIndex = 0;
      });
      document.querySelectorAll('.dl-main button[title], [data-admin-dialog] button[title]').forEach(button => {
        if (!button.textContent.trim() && (!button.hasAttribute('aria-label') || button.dataset.adminTitleLabel === 'true')) {
          button.setAttribute('aria-label', button.title);
          button.dataset.adminTitleLabel = 'true';
        }
      });
      document.querySelectorAll('.dl-main label, [data-admin-dialog] label').forEach(label => {
        if (label.htmlFor || label.querySelector('input,select,textarea')) return;
        const control = label.nextElementSibling;
        if (!control?.matches('input,select,textarea')) return;
        if (!control.id) control.id = `admin-field-${++sequence}`;
        label.htmlFor = control.id;
      });
      if (dialogs.size && savedOverflow === undefined) {
        savedOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      } else if (!dialogs.size && savedOverflow !== undefined) {
        document.body.style.overflow = savedOverflow;
        savedOverflow = undefined;
      }
    };
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(scan); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
    const keyboard = event => {
      const dialog = topDialog();
      if (!dialog || event.defaultPrevented) return;
      const portals = [...document.querySelectorAll('[data-admin-popup]')].filter(visible);
      if (event.key === 'Escape' && !portals.length && !event.target.closest?.('[data-admin-popup]')) {
        const close = [...dialog.querySelectorAll('[data-admin-close]')].find(button => !button.disabled && visible(button));
        if (close) { event.preventDefault(); close.click(); }
      }
      if (event.key !== 'Tab') return;
      const targets = [...dialog.querySelectorAll(focusable), ...portals.flatMap(p => [...p.querySelectorAll(focusable)])].filter(visible);
      const index = targets.indexOf(document.activeElement);
      if (!targets.length) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && index <= 0) { event.preventDefault(); targets.at(-1).focus(); }
      else if (!event.shiftKey && (index < 0 || index === targets.length - 1)) { event.preventDefault(); targets[0].focus(); }
    };
    document.addEventListener('keydown', keyboard);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(scheduled);
      document.removeEventListener('keydown', keyboard);
      if (savedOverflow !== undefined) document.body.style.overflow = savedOverflow;
    };
  }, []);
}
