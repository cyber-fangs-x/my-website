// TODO: Combine with ui_design/tabs.js
// TODO: Add dragging funtionality using pseudocode below 
const boxes = document.querySelectorAll('.draggable-container');

let activeBox = null;
let isDragging = false;
let offsetX = 0;
let offsetY = 0;
let placeholder = null;

boxes.forEach(box => {
  box.addEventListener('mousedown', (e) => {
    // 🟢 CHANGE: Verify the user clicked the header before proceeding
    const dragHandle = e.target.closest('.header');
    if (!dragHandle) return; // Exit completely if they clicked the content area instead

    isDragging = true;
    activeBox = box;
    
    // Switch cursor styling on the specific handle being used
    dragHandle.style.cursor = 'grabbing';
    activeBox.style.zIndex = '1000';

    const rect = activeBox.getBoundingClientRect();
    const parentRowRect = activeBox.parentElement.getBoundingClientRect();

    // 1. Create matching dimensions placeholder
    placeholder = document.createElement('div');
    placeholder.className = 'drag-placeholder';
    placeholder.style.width = `${rect.width}px`;
    placeholder.style.height = `${rect.height}px`;
    placeholder.style.flex = window.getComputedStyle(activeBox).flex;
    activeBox.before(placeholder);

    // 2. Track mouse click offsets
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    // 3. Freeze dimensions
    activeBox.style.width = `${rect.width}px`;
    activeBox.style.height = `${rect.height}px`;

    // 4. Snap into absolute layout positions
    activeBox.style.position = 'absolute';
    activeBox.style.left = `${rect.left - parentRowRect.left}px`;
    activeBox.style.top = `${rect.top - parentRowRect.top}px`;
    activeBox.style.margin = '0';
  });
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging || !activeBox) return;

  const parentRowRect = activeBox.parentElement.getBoundingClientRect();
  let newX = e.clientX - parentRowRect.left - offsetX;
  let newY = e.clientY - parentRowRect.top - offsetY;

  activeBox.style.left = `${newX}px`;
  activeBox.style.top = `${newY}px`;
});

document.addEventListener('mouseup', () => {
  if (isDragging && activeBox) {
    // 🟢 CHANGE: Reset cursor on the header specifically
    const dragHandle = activeBox.querySelector('.header');
    if (dragHandle) dragHandle.style.cursor = 'grab';
    
    activeBox.style.zIndex = '';
    isDragging = false;
    activeBox = null;
    placeholder = null;
  }
});
