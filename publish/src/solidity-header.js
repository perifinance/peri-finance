'use strict';

module.exports = {
	addSolidityHeader({ content, contract }) {
		const deps = Array.from(
			// remove dupes via a set
			new Set(
				// get all potential extensions
				(content.match(/\ncontract [\w]+ is ([\w,\s]+) {/g) || [])
					.map(text => text.match(/is ([\w\s,]+) {/)[1].split(','))
					// flatten
					.reduce((a, b) => a.concat(b), [])
					// and trim spaces
					.map(x => x.trim())
					// sorting alphabetically
					.sort()
			)
		);

		const libraries = Array.from(
			new Set(
				// get all potential extensions
				(content.match(/\nlibrary [\w]+ {/g) || [])
					.map(text =>
						text
							.match(/([\w]+) {/)[1]
							// and trim spaces
							.trim()
					)
					.sort()
			)
		);

		return `/*
    ___            _       ___  _                          
    | .\\ ___  _ _ <_> ___ | __><_>._ _  ___ ._ _  ___  ___ 
    |  _// ._>| '_>| ||___|| _> | || ' |<_> || ' |/ | '/ ._>
    |_|  \\___.|_|  |_|     |_|  |_||_|_|<___||_|_|\\_|_.\\___.
    
* PeriFinance: ${contract}
*
* Latest source (may be newer): https://github.com/perifinance/peri-finance/blob/master/contracts/${contract}
* Docs: Will be added in the future. 
* https://docs.peri.finance/contracts/source/contracts/${contract.split(/\./)[0]}
*
* Contract Dependencies: ${deps.length ? '\n*\t- ' + deps.join('\n*\t- ') : '(none)'}
* Libraries: ${libraries.length ? '\n*\t- ' + libraries.join('\n*\t- ') : '(none)'}
*
* MIT License
* ===========
*
* Copyright (c) ${new Date().getFullYear()} PeriFinance
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
*/

${content}
    `;
	},
};
