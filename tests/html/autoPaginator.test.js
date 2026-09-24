import { autoPaginate, isPageContentEmpty } from '../../client/homebrew/brewRenderer/autoPaginator.js';

// Setup global Node constants if not defined in test environment
global.Node = global.Node || {
	ELEMENT_NODE : 1,
	TEXT_NODE    : 3,
	COMMENT_NODE : 8
};

global.NodeFilter = global.NodeFilter || {
	SHOW_TEXT : 4
};

function createMockElement(tagName = 'div') {
	const el = {
		tagName   : tagName.toUpperCase(),
		nodeType  : Node.ELEMENT_NODE,
		style     : {},
		classList : {
			_classes : new Set(),
			add(c) { this._classes.add(c); },
			remove(c) { this._classes.delete(c); },
			contains(c) { return this._classes.has(c); }
		},
		children     : [],
		childNodes   : [],
		_innerHTML   : '',
		_textContent : '',
		clientWidth  : 650,
		clientHeight : 900,
		offsetHeight : 900,

		get innerHTML() {
			if(this.childNodes.length > 0) {
				return this.childNodes.map((n)=>n.nodeType === Node.TEXT_NODE ? n.textContent : (n.outerHTML || n.innerHTML)).join('');
			}
			return this._innerHTML;
		},
		set innerHTML(val) {
			this._innerHTML = val;
			this.childNodes = [];
			if(val && !val.includes('<')) {
				this.appendChild(createMockTextNode(val));
			}
		},

		get outerHTML() {
			const classStr = this.className ? ` class="${this.className}"` : '';
			const idStr = this.id ? ` id="${this.id}"` : '';
			return `<${this.tagName.toLowerCase()}${idStr}${classStr}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
		},

		get className() {
			return Array.from(this.classList._classes).join(' ');
		},
		set className(val) {
			this.classList._classes = new Set(val.split(/\s+/).filter(Boolean));
		},

		get textContent() {
			if(this.childNodes.length > 0) {
				return this.childNodes.map((n)=>n.textContent).join('');
			}
			return this._textContent;
		},
		set textContent(val) {
			this._textContent = val;
			this.childNodes = [];
			if(val) {
				this.appendChild(createMockTextNode(val));
			}
		},

		appendChild(child) {
			this.childNodes.push(child);
			child.parentNode = this;
			if(child.nodeType === Node.ELEMENT_NODE) {
				this.children.push(child);
			}
			return child;
		},

		cloneNode(deep = true) {
			const clone = createMockElement(this.tagName);
			clone.className = this.className;
			clone.id = this.id;
			clone.style = { ...this.style };
			clone._innerHTML = this._innerHTML;
			clone._textContent = this._textContent;
			clone.clientWidth = this.clientWidth;
			clone.clientHeight = this.clientHeight;
			clone.offsetHeight = this.offsetHeight;
			clone.getClientRects = this.getClientRects;
			clone.getBoundingClientRect = this.getBoundingClientRect;
			if(deep) {
				this.childNodes.forEach((child)=>clone.appendChild(child.cloneNode(true)));
			}
			return clone;
		},

		getClientRects() {
			return [{ left: 50, right: 350, top: 50, bottom: 300 }];
		},

		getBoundingClientRect() {
			return { left: 50, right: 700, top: 50, bottom: 950 };
		}
	};

	return el;
}

function createMockTextNode(text) {
	return {
		nodeType    : Node.TEXT_NODE,
		textContent : text,
		cloneNode() {
			return createMockTextNode(this.textContent);
		}
	};
}

function createMockDoc() {
	const body = createMockElement('body');
	const elementsById = new Map();

	return {
		body,
		getElementById(id) {
			return elementsById.get(id) || null;
		},
		createElement(tag) {
			const el = createMockElement(tag);
			return el;
		},
		createRange() {
			let endOffset = 0;
			return {
				selectNodeContents(node) {
					endOffset = node?.textContent?.length || 0;
				},
				setStart() {},
				setEnd(node, offset) {
					endOffset = offset;
				},
				getClientRects() {
					return [{ left: 50, right: 350, top: 50, bottom: 200 }];
				}
			};
		},
		createTreeWalker(root) {
			const textNodes = [];
			function collect(node) {
				if(node.nodeType === Node.TEXT_NODE) textNodes.push(node);
				else if(node.childNodes) node.childNodes.forEach(collect);
			}
			collect(root);
			let index = 0;
			return {
				nextNode() {
					return textNodes[index++] || null;
				}
			};
		},
		defaultView : {
			getComputedStyle() {
				return {};
			}
		}
	};
}

describe('autoPaginator', ()=>{
	test('returns input html in array if doc is not provided or html is empty', ()=>{
		const mockDoc = createMockDoc();
		expect(autoPaginate('', '', {}, null)).toEqual(['']);
		expect(autoPaginate('<p>Hello</p>', '', {}, null)).toEqual(['<p>Hello</p>']);
		expect(autoPaginate('', '', {}, mockDoc)).toEqual(['']);
	});

	test('returns single page when content fits within 2 columns', ()=>{
		const mockDoc = createMockDoc();
		const origCreate = mockDoc.createElement.bind(mockDoc);
		mockDoc.createElement = (tag)=>{
			const el = origCreate(tag);
			if(tag === 'div') {
				el.getClientRects = ()=>([{ left: 50, right: 350, top: 50, bottom: 300 }]);
				el.getBoundingClientRect = ()=>({ left: 50, right: 700, top: 50, bottom: 950 });
			}
			return el;
		};

		const html = '<p>Short content that fits in 2 columns.</p>';
		const result = autoPaginate(html, 'phb', {}, mockDoc);
		expect(result).toHaveLength(1);
	});

	test('splits content into multiple pages when content overflows Column 2 into Column 3', ()=>{
		const mockDoc = createMockDoc();
		const origCreate = mockDoc.createElement.bind(mockDoc);

		const pagePass = 0;

		const p1 = createMockElement('div');
		p1.id = 'col1';
		const p2 = createMockElement('div');
		p2.id = 'col2';
		const p3 = createMockElement('div');
		p3.id = 'col3';
		const p4 = createMockElement('div');
		p4.id = 'col4';

		mockDoc.createElement = (tag)=>{
			const el = origCreate(tag);
			if(tag === 'div') {
				el.getClientRects = function() {
					if(pagePass === 0) {
						if(this.id === 'col3' || this.id === 'col4') {
							return [{ left: 800, right: 1100, top: 50, bottom: 300 }]; // in Col 3 on page 1
						}
					}
					// On page 2, p3 & p4 are in Col 1 & Col 2
					if(this.id === 'col3') return [{ left: 50, right: 350, top: 50, bottom: 300 }];
					if(this.id === 'col4') return [{ left: 400, right: 700, top: 50, bottom: 300 }];
					return [{ left: 50, right: 350, top: 50, bottom: 300 }];
				};
				el.getBoundingClientRect = ()=>({ left: 50, right: 700, top: 50, bottom: 950 });

				Object.defineProperty(el, 'innerHTML', {
					get() {
						return this.childNodes.map((n)=>n.outerHTML || n.textContent).join('');
					},
					set(val) {
						if(val.includes('test-overflow')) {
							this.childNodes = [p1, p2, p3, p4];
						} else {
							this._innerHTML = val;
						}
					}
				});
			}
			return el;
		};

		p1.getClientRects = ()=>([{ left: 50, right: 350, top: 50, bottom: 300 }]);
		p2.getClientRects = ()=>([{ left: 400, right: 700, top: 50, bottom: 300 }]);
		p3.getClientRects = function() {
			return pagePass === 0 ? [{ left: 800, right: 1100, top: 50, bottom: 300 }] : [{ left: 50, right: 350, top: 50, bottom: 300 }];
		};
		p4.getClientRects = function() {
			return pagePass === 0 ? [{ left: 800, right: 1100, top: 350, bottom: 600 }] : [{ left: 400, right: 700, top: 50, bottom: 300 }];
		};

		const result = autoPaginate('test-overflow', 'phb', {}, mockDoc);
		expect(result[0]).toContain('col1');
		expect(result[0]).toContain('col2');
	});

	test('unbreakable elements like monster blocks and tables are not split internally', ()=>{
		const mockDoc = createMockDoc();
		const origCreate = mockDoc.createElement.bind(mockDoc);

		let pass = 0;
		const p1 = createMockElement('div');
		p1.id = 'p1';
		p1.textContent = 'First page text';
		p1.getClientRects = ()=>([{ left: 50, right: 350, top: 50, bottom: 300 }]);

		const monster = createMockElement('div');
		monster.className = 'monster';
		monster.id = 'monster-dragon';
		monster.textContent = 'Dragon AC 19 HP 200';
		monster.getClientRects = function() {
			if(pass === 0) {
				pass++;
				return [{ left: 800, right: 1100, top: 50, bottom: 400 }];
			}
			return [{ left: 50, right: 350, top: 50, bottom: 400 }];
		};

		mockDoc.createElement = (tag)=>{
			const el = origCreate(tag);
			if(tag === 'div') {
				el.getClientRects = function() {
					if(this.classList.contains('monster')) {
						return monster.getClientRects();
					}
					return [{ left: 50, right: 350, top: 50, bottom: 300 }];
				};
				el.getBoundingClientRect = ()=>({ left: 50, right: 700, top: 50, bottom: 950 });

				Object.defineProperty(el, 'innerHTML', {
					get() {
						return this.childNodes.map((n)=>n.outerHTML || n.textContent).join('');
					},
					set(val) {
						if(val.includes('test-monster')) {
							this.childNodes = [p1, monster];
						} else {
							this._innerHTML = val;
						}
					}
				});
			}
			return el;
		};

		const result = autoPaginate('test-monster', 'phb', {}, mockDoc);
		expect(result.length).toBe(2);
		expect(result[0]).toContain('id="p1"');
		expect(result[1]).toContain('monster-dragon');
	});

	test('splits text elements across pages and preserves paragraph integrity', ()=>{
		const mockDoc = createMockDoc();
		const origCreate = mockDoc.createElement.bind(mockDoc);

		let pass = 0;
		const p = createMockElement('p');
		p.id = 'p-text';
		p.textContent = 'Hello world this is a test of splitting long paragraphs';
		p.getClientRects = function() {
			if(pass === 0) {
				pass++;
				return [
					{ left: 400, right: 700, top: 50, bottom: 900 },
					{ left: 800, right: 1100, top: 50, bottom: 200 }
				];
			}
			return [{ left: 50, right: 350, top: 50, bottom: 200 }];
		};

		mockDoc.createRange = ()=>{
			let endOffset = 0;
			return {
				selectNodeContents(node) {
					endOffset = node?.textContent?.length || 0;
				},
				setStart() {},
				setEnd(node, offset) { endOffset = offset; },
				getClientRects() {
					if(endOffset > 25) {
						return [
							{ left: 400, right: 700, top: 50, bottom: 900 },
							{ left: 800, right: 1100, top: 50, bottom: 200 }
						];
					}
					return [{ left: 400, right: 700, top: 50, bottom: 850 }];
				}
			};
		};

		mockDoc.createElement = (tag)=>{
			const el = origCreate(tag);
			if(tag === 'div') {
				el.getBoundingClientRect = ()=>({ left: 50, right: 700, top: 50, bottom: 950 });
				Object.defineProperty(el, 'innerHTML', {
					get() {
						return this.childNodes.map((n)=>n.outerHTML || n.textContent).join('');
					},
					set(val) {
						if(val.includes('test-paragraph')) {
							this.childNodes = [p];
						} else {
							this._innerHTML = val;
						}
					}
				});
			}
			return el;
		};

		const result = autoPaginate('test-paragraph', 'phb', {}, mockDoc);
		expect(result.length).toBe(2);
		expect(result[0]).toContain('Hello world');
		expect(result[1]).toContain('splitting long');
	});

	test('isPageContentEmpty identifies empty strings, whitespace, &nbsp;, and empty tags', ()=>{
		expect(isPageContentEmpty('')).toBe(true);
		expect(isPageContentEmpty('   \n\t  ')).toBe(true);
		expect(isPageContentEmpty('&nbsp;')).toBe(true);
		expect(isPageContentEmpty('<p>&nbsp;</p>')).toBe(true);
		expect(isPageContentEmpty('<div class="columnSplit"></div><p>&nbsp;</p>')).toBe(true);
		expect(isPageContentEmpty('<div><span>   </span></div>')).toBe(true);
		expect(isPageContentEmpty('<p>Real text</p>')).toBe(false);
		expect(isPageContentEmpty('<img src="test.png">')).toBe(false);
		expect(isPageContentEmpty('<hr>')).toBe(false);
		expect(isPageContentEmpty('<table><tr><td>Cell</td></tr></table>')).toBe(false);
	});

	test('does not create an extra page if the overflow content is purely empty or whitespace', ()=>{
		const mockDoc = createMockDoc();
		const origCreate = mockDoc.createElement.bind(mockDoc);

		const p1 = createMockElement('div');
		p1.id = 'col1';
		p1.textContent = 'Actual content in column 1 and 2';
		p1.getClientRects = ()=>([{ left: 50, right: 350, top: 50, bottom: 300 }]);

		const emptyTrailing = createMockElement('div');
		emptyTrailing.className = 'columnSplit';
		emptyTrailing.innerHTML = '&nbsp;';
		emptyTrailing.getClientRects = ()=>([{ left: 800, right: 1100, top: 50, bottom: 100 }]); // in Col 3

		mockDoc.createElement = (tag)=>{
			const el = origCreate(tag);
			if(tag === 'div') {
				el.getClientRects = function() {
					if(this.className === 'columnSplit') {
						return [{ left: 800, right: 1100, top: 50, bottom: 100 }];
					}
					return [{ left: 50, right: 350, top: 50, bottom: 300 }];
				};
				el.getBoundingClientRect = ()=>({ left: 50, right: 700, top: 50, bottom: 950 });

				Object.defineProperty(el, 'innerHTML', {
					get() {
						return this.childNodes.map((n)=>n.outerHTML || n.textContent).join('');
					},
					set(val) {
						if(val.includes('test-trailing-empty')) {
							this.childNodes = [p1, emptyTrailing];
						} else {
							this._innerHTML = val;
						}
					}
				});
			}
			return el;
		};

		const result = autoPaginate('test-trailing-empty', 'phb', {}, mockDoc);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain('Actual content');
	});
});
