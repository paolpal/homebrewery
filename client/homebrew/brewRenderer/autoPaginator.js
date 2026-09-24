/**
 * Auto-paginator for Homebrewery.
 * Detects multi-column overflow (content flowing past 2 columns) and splits
 * content across pages so every two columns becomes a distinct page.
 */

const UNBREAKABLE_TAGS = new Set([
	'TABLE', 'IMG', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'PRE', 'SVG', 'FIGURE', 'UL', 'OL', 'DL'
]);

const UNBREAKABLE_CLASSES = [
	'block', 'monster', 'note', 'descriptive', 'wide', 'columnSplit'
];

/**
 * Checks if HTML or a DOM container is visually empty (no text, images, tables, etc.).
 */
export const isPageContentEmpty = (html)=>{
	if(!html) return true;
	if(/<(img|svg|table|canvas|hr|iframe|video|audio)[^>]*>/i.test(html)) {
		return false;
	}
	const stripped = html.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;|\u00a0/g, ' ').trim();
	return stripped.length === 0;
};

/**
 * Determines whether a DOM element should be kept unbroken across column/page boundaries.
 */
const isUnbreakable = (element, computedStyle)=>{
	const tagName = element.tagName?.toUpperCase();
	if(UNBREAKABLE_TAGS.has(tagName)) return true;

	if(element.classList) {
		for (const cls of UNBREAKABLE_CLASSES) {
			if(element.classList.contains(cls)) return true;
		}
	}

	const breakInside = computedStyle?.breakInside || computedStyle?.webkitColumnBreakInside;
	if(breakInside === 'avoid' || breakInside === 'avoid-column' || breakInside === 'avoid-page') {
		return true;
	}

	return false;
};

/**
 * Attempts to binary-search split a text-containing element across the column boundary.
 */
const splitTextElement = (element, doc, rightBound, bottomBound)=>{
	const fullText = element.textContent;
	if(!fullText || fullText.trim().length <= 1) return null;

	const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
	let textNode;

	while ((textNode = walker.nextNode())) {
		const text = textNode.textContent;
		if(!text.trim()) continue;

		const range = doc.createRange();
		range.selectNodeContents(textNode);
		const rects = Array.from(range.getClientRects());
		if(!rects.length) continue;

		// If the start of this text node is already beyond Column 2, cannot split this node here
		if(rects[0].left >= rightBound || rects[0].bottom > bottomBound + 2) {
			return null;
		}

		// Check if last rect crosses boundary
		const lastRect = rects[rects.length - 1];
		if(lastRect.left >= rightBound || lastRect.bottom > bottomBound + 2) {
			// Binary search for split character index
			let low = 0;
			let high = text.length;
			let splitChar = -1;

			while (low <= high) {
				const mid = Math.floor((low + high) / 2);
				range.setStart(textNode, 0);
				range.setEnd(textNode, mid);
				const subRects = Array.from(range.getClientRects());
				const subLastRect = subRects[subRects.length - 1];

				if(subLastRect && (subLastRect.left >= rightBound || subLastRect.bottom > bottomBound + 2)) {
					splitChar = mid;
					high = mid - 1;
				} else {
					low = mid + 1;
				}
			}

			if(splitChar > 0) {
				let spaceIndex = text.lastIndexOf(' ', splitChar);
				if(spaceIndex <= 0) {
					spaceIndex = splitChar;
				}

				const textBefore = text.substring(0, spaceIndex).trimEnd();
				const textAfter = text.substring(spaceIndex).trimStart();

				if(textBefore.length > 0 && textAfter.length > 0) {
					const nodeBefore = element.cloneNode(true);
					const nodeAfter = element.cloneNode(true);
					nodeBefore.textContent = textBefore;
					nodeAfter.textContent = textAfter;
					return { node: nodeBefore, continuation: nodeAfter };
				}
			}
		}
	}

	return null;
};

/**
 * Finds the first overflowing child node within childNodes.
 */
const findSplitPoint = (childNodes, doc, rightBound, bottomBound, midX)=>{
	for (let i = 0; i < childNodes.length; i++) {
		const node = childNodes[i];
		if(node.nodeType === Node.COMMENT_NODE) continue;

		if(node.nodeType === Node.TEXT_NODE) {
			if(!node.textContent.trim()) continue;
			const range = doc.createRange();
			range.selectNodeContents(node);
			const rects = Array.from(range.getClientRects());
			if(rects.length > 0) {
				const hasCol3 = rects.some((r)=>r.left >= rightBound);
				const inCol2 = rects.some((r)=>r.left >= midX - 10);
				const hasCol2Overflow = inCol2 && rects.some((r)=>r.bottom > bottomBound + 2);
				if(hasCol3 || hasCol2Overflow) {
					return { index: i, node: null, continuation: null };
				}
			}
			continue;
		}

		if(node.nodeType === Node.ELEMENT_NODE) {
			const computedStyle = doc.defaultView?.getComputedStyle(node) || {};
			if(
				computedStyle.position === 'absolute' ||
				computedStyle.position === 'fixed' ||
				computedStyle.display === 'none'
			) {
				continue;
			}

			const rects = Array.from(node.getClientRects());
			if(!rects.length) continue;

			const hasCol3 = rects.some((r)=>r.left >= rightBound);
			const inCol2 = rects.some((r)=>r.left >= midX - 10);
			const hasCol2Overflow = inCol2 && rects.some((r)=>r.bottom > bottomBound + 2);

			if(hasCol3 || hasCol2Overflow) {
				// If the element starts at Column 3 or is unbreakable, split before it
				if(rects[0].left >= rightBound || (inCol2 && rects[0].bottom > bottomBound + 2) || isUnbreakable(node, computedStyle)) {
					return { index: i, node: null, continuation: null };
				}

				// Try splitting the text element
				const splitResult = splitTextElement(node, doc, rightBound, bottomBound);
				if(splitResult?.continuation) {
					return {
						index        : i,
						node         : splitResult.node,
						continuation : splitResult.continuation
					};
				}

				return { index: i, node: null, continuation: null };
			}
		}
	}

	return null;
};

/**
 * Paginates an HTML string across 2-column pages.
 * @param {string} html - The input HTML for a page section.
 * @param {string} className - Additional classes on the .page element.
 * @param {object} styles - Inline styles for the .page element.
 * @param {Document} doc - The document (usually iframe contentDocument) for measuring layout.
 * @returns {string[]} Array of HTML strings, one for each resulting page.
 */
export const autoPaginate = (html, className = '', styles = {}, doc = null)=>{
	if(!doc?.body || !html) return [html];

	// Create or reuse hidden measurement container
	let measureContainer = doc.getElementById('hb-measure-container');
	if(!measureContainer) {
		measureContainer = doc.createElement('div');
		measureContainer.id = 'hb-measure-container';
		measureContainer.style.cssText =
			'position: fixed; left: -9999px; top: 0; width: 215.9mm; height: 279.4mm; visibility: hidden; pointer-events: none; z-index: -9999;';
		doc.body.appendChild(measureContainer);
	}

	const testPage = doc.createElement('div');
	testPage.className = `page ${className}`.trim();
	testPage.style.cssText = 'content-visibility: visible !important; contain: none !important;';
	if(styles && typeof styles === 'object') {
		Object.assign(testPage.style, styles);
		testPage.style.contentVisibility = 'visible';
		testPage.style.contain = 'none';
	}

	const columnWrapper = doc.createElement('div');
	columnWrapper.className = 'columnWrapper';
	columnWrapper.innerHTML = html;
	testPage.appendChild(columnWrapper);

	measureContainer.innerHTML = '';
	measureContainer.appendChild(testPage);

	const pages = [];
	const MAX_PAGES = 50;

	const paginateStep = (currentWrapper, depth = 0)=>{
		if(depth >= MAX_PAGES) {
			if(!isPageContentEmpty(currentWrapper.innerHTML)) {
				pages.push(currentWrapper.innerHTML);
			}
			return;
		}

		// Force layout reflow
		currentWrapper.offsetHeight;
		const colRect = currentWrapper.getBoundingClientRect();
		const rightBound = colRect.left + currentWrapper.clientWidth - 5;
		const bottomBound = colRect.top + (currentWrapper.clientHeight || testPage.clientHeight || 939);
		const midX = colRect.left + currentWrapper.clientWidth / 2;

		const childNodes = Array.from(currentWrapper.childNodes);
		const split = findSplitPoint(childNodes, doc, rightBound, bottomBound, midX);

		if(!split || split.index < 0) {
			if(pages.length === 0 || !isPageContentEmpty(currentWrapper.innerHTML)) {
				pages.push(currentWrapper.innerHTML);
			}
			return;
		}

		// Prepare nextWrapper to check if the remaining overflow contains actual visible content
		const nextWrapper = doc.createElement('div');
		nextWrapper.className = 'columnWrapper';
		if(split.continuation) {
			nextWrapper.appendChild(split.continuation);
			childNodes.slice(split.index + 1).forEach((node)=>nextWrapper.appendChild(node.cloneNode(true)));
		} else {
			childNodes.slice(split.index).forEach((node)=>nextWrapper.appendChild(node.cloneNode(true)));
		}

		// If remaining content is empty (e.g. only trailing whitespace/column breaks), stop here
		if(isPageContentEmpty(nextWrapper.innerHTML)) {
			pages.push(currentWrapper.innerHTML);
			return;
		}

		// Prevent infinite loop if index is 0 with no progress
		if(split.index === 0 && !split.node) {
			if(childNodes.length <= 1) {
				pages.push(currentWrapper.innerHTML);
				return;
			}
			split.index = 1;
		}

		const pageNodes = childNodes.slice(0, split.index);
		const pageDiv = doc.createElement('div');
		pageNodes.forEach((node)=>pageDiv.appendChild(node.cloneNode(true)));
		if(split.node) {
			pageDiv.appendChild(split.node.cloneNode(true));
		}

		if(pages.length === 0 || !isPageContentEmpty(pageDiv.innerHTML)) {
			pages.push(pageDiv.innerHTML);
		}

		testPage.innerHTML = '';
		testPage.appendChild(nextWrapper);

		paginateStep(nextWrapper, depth + 1);
	};

	paginateStep(columnWrapper, 0);

	measureContainer.innerHTML = '';

	// Remove any trailing empty pages
	while (pages.length > 1 && isPageContentEmpty(pages[pages.length - 1])) {
		pages.pop();
	}

	return pages.length > 0 ? pages : [html];
};

export default autoPaginate;
