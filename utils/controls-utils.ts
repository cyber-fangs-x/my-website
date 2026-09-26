/**
 * Attaches standardized UI behaviors (styles, ripples) and hooks up custom feature functions.
 * 
 * @param element - The target DOM element
 * @param customFn - The background feature function to run on click
 * @returns A cleanup function to remove the event listener
 */
export function initializeButton(
    element: HTMLElement | null, 
    customFn: (event: Event) => void
): () => void {
    if (!element) {
        console.log("initializeButton: element is null, no event listener attached.");
        return () => {};
    }
    
    // 1. Visual Feedback Logic (Instant touch/mouse response)
    const handlePointerDown = () => element.classList.add('is-pressed');
    const handlePointerUp = () => element.classList.remove('is-pressed');

    // 2. Execution Logic
    const handleClick = (event: Event) => {
        element.classList.toggle('is-toggled');
        customFn(event); // We just pass the event itself
    };

    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointerup', handlePointerUp);
    element.addEventListener('pointerleave', handlePointerUp);
    element.addEventListener('pointercancel', handlePointerUp);
    element.addEventListener('click', handleClick);

    return () => {
        element.removeEventListener('pointerdown', handlePointerDown);
        element.removeEventListener('pointerup', handlePointerUp);
        element.removeEventListener('pointerleave', handlePointerUp);
        element.removeEventListener('pointercancel', handlePointerUp);
        element.removeEventListener('click', handleClick);
    };
}

/**
 * One radio option's behavior. onSelect runs when the option becomes the
 * selected one; onDeselect (optional) runs when selection moves away from it,
 * so a mode can tear down its own state before the next mode takes over.
 */
export interface RadioOption {
    onSelect: () => void;
    onDeselect?: () => void;
}

/**
 * Wires a group of native radio inputs, already written in the page's HTML,
 * to per-option onSelect/onDeselect functions — e.g. switching a graphics
 * script between visualization modes.
 *
 * Why: the HTML owns the markup (labels, order, which option starts
 * `checked`) and the graphics script owns the behavior, keyed by each
 * input's `value`. The `checked` attribute is the single source of truth for
 * the starting mode: its onSelect runs once at init, so the scene and the UI
 * can't disagree about which mode is active.
 *
 * How: same two-part split as initializeButton —
 *   1. Visual feedback: pointerdown/up toggles `is-pressed` on each input (the
 *      hook for future press animations). Listeners go on the input's
 *      wrapping <label> when there is one, so pressing the label text counts.
 *   2. Execution: listens for `change`, not `click`. `change` fires only when
 *      an option actually becomes checked (mouse, label, or arrow keys);
 *      re-clicking the already-selected radio fires `click` but not `change`,
 *      and `click` would wrongly run onDeselect + onSelect on the same option.
 * The previous option's onDeselect always runs before the new option's
 * onSelect, so teardown finishes before the new mode writes shared state.
 *
 * HTML contract: every input in the group shares one `name` (unique on the
 * page — that's what makes the browser allow only one checked), and each
 * input's `value` matches a key in `options`.
 *
 * @param container - Element containing the group's `<input type="radio">`s
 * @param options - onSelect/onDeselect per option, keyed by input `value`
 * @returns A cleanup function to remove all event listeners
 */
export function initializeRadioGroup(
    container: HTMLElement | null,
    options: Record<string, RadioOption>
): () => void {
    if (!container) {
        console.log("initializeRadioGroup: container is null, no event listeners attached.");
        return () => {};
    }

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));

    // Catch HTML/TS typos: a radio with no behavior, or behavior with no radio.
    const values = new Set(inputs.map(input => input.value));
    for (const value of values) {
        if (!(value in options)) console.warn(`initializeRadioGroup: radio value "${value}" has no matching option.`);
    }
    for (const key of Object.keys(options)) {
        if (!values.has(key)) console.warn(`initializeRadioGroup: option "${key}" has no matching radio input.`);
    }

    let selected: string | null = null;
    const select = (value: string) => {
        if (selected !== null) options[selected]?.onDeselect?.();
        selected = value;
        options[value]?.onSelect();
    };

    const cleanups: Array<() => void> = [];
    for (const input of inputs) {
        const pressTarget = input.closest('label') ?? input;

        // 1. Visual Feedback Logic (Instant touch/mouse response)
        const handlePointerDown = () => input.classList.add('is-pressed');
        const handlePointerUp = () => input.classList.remove('is-pressed');

        // 2. Execution Logic
        const handleChange = () => {
            if (input.checked) select(input.value);
        };

        pressTarget.addEventListener('pointerdown', handlePointerDown);
        pressTarget.addEventListener('pointerup', handlePointerUp);
        pressTarget.addEventListener('pointerleave', handlePointerUp);
        pressTarget.addEventListener('pointercancel', handlePointerUp);
        input.addEventListener('change', handleChange);

        cleanups.push(() => {
            pressTarget.removeEventListener('pointerdown', handlePointerDown);
            pressTarget.removeEventListener('pointerup', handlePointerUp);
            pressTarget.removeEventListener('pointerleave', handlePointerUp);
            pressTarget.removeEventListener('pointercancel', handlePointerUp);
            input.removeEventListener('change', handleChange);
        });
    }

    // Starting mode comes from the HTML's `checked` attribute.
    const initial = inputs.find(input => input.checked);
    if (initial) select(initial.value);

    return () => cleanups.forEach(cleanup => cleanup());
}

