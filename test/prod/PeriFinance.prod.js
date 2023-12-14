const fs = require('fs');
const path = require('path');
const { grey, red } = require('chalk');
const { web3, contract, artifacts, config } = require('hardhat');
const { assert, addSnapshotBeforeRestoreAfter } = require('../contracts/common');
const { toUnit, fromUnit } = require('../utils')();
const { knownAccounts, wrap, toBytes32 } = require('../..');
const {
	connectContracts,
	connectContract,
	ensureAccountHasEther,
	ensureAccountHaspUSD,
	ensureAccountHasPERI,
	skipWaitingPeriod,
	skipStakeTime,
	writeSetting,
	avoidStaleRates,
	simulateExchangeRates,
	takeDebtSnapshot,
	mockOptimismBridge,
	implementsVirtualPynths,
	resumeSystem,
} = require('./utils');

const gasFromReceipt = ({ receipt }) =>
	receipt.gasUsed > 1e6 ? receipt.gasUsed / 1e6 + 'm' : receipt.gasUsed / 1e3 + 'k';

contract('PeriFinance (prod tests)', accounts => {
	const [, user1, user2] = accounts;

	let owner;

	let network, deploymentPath;

	let PeriFinance, PeriFinanceState, ReadProxyAddressResolver;
	let PynthpUSD, PynthpETH;

	before('prepare', async () => {
		network = config.targetNetwork;
		const { getUsers, getPathToNetwork } = wrap({ network, fs, path });
		deploymentPath = config.deploymentPath || getPathToNetwork(network);
		owner = getUsers({ network, user: 'owner' }).address;

		await avoidStaleRates({ network, deploymentPath });
		await takeDebtSnapshot({ network, deploymentPath });
		await resumeSystem({ owner, network, deploymentPath });

		if (config.patchFreshDeployment) {
			await simulateExchangeRates({ network, deploymentPath });
			await mockOptimismBridge({ network, deploymentPath });
		}

		({
			PeriFinance,
			PeriFinanceState,
			PynthpUSD,
			PynthpETH,
			ReadProxyAddressResolver,
		} = await connectContracts({
			network,
			deploymentPath,
			requests: [
				{ contractName: 'PeriFinance' },
				{ contractName: 'PeriFinanceState' },
				{ contractName: 'ProxyERC20pUSD', abiName: 'Pynth', alias: 'PynthpUSD' },
				{ contractName: 'ProxypETH', abiName: 'Pynth', alias: 'PynthpETH' },
				{ contractName: 'ReadProxyAddressResolver' },
				{ contractName: 'ProxyERC20', abiName: 'PeriFinance' },
			],
		}));

		await skipWaitingPeriod({ network, deploymentPath });

		await ensureAccountHasEther({
			amount: toUnit('1'),
			account: owner,
			network,
			deploymentPath,
		});
		await ensureAccountHaspUSD({
			amount: toUnit('100'),
			account: user1,
			network,
			deploymentPath,
		});
		await ensureAccountHasPERI({
			amount: toUnit('100'),
			account: user1,
			network,
			deploymentPath,
		});
	});

	beforeEach('check debt snapshot', async () => {
		await takeDebtSnapshot({ network, deploymentPath });
	});

	describe('core infrastructure', () => {
		describe('misc state', () => {
			it('has the expected resolver set', async () => {
				assert.equal(await PeriFinance.resolver(), ReadProxyAddressResolver.address);
			});

			// it('does not report any rate to be stale or invalid', async () => {
			// 	assert.isFalse(await Issuer.anyPynthOrPERIRateIsInvalid());
			// });

			it('reports matching totalIssuedPynths and debtLedger', async () => {
				const totalIssuedPynths = await PeriFinance.totalIssuedPynths(toBytes32('pUSD'));
				const debtLedgerLength = await PeriFinanceState.debtLedgerLength();

				assert.isFalse(debtLedgerLength > 0 && totalIssuedPynths === 0);
			});
		});

		describe('erc20 functionality', () => {
			addSnapshotBeforeRestoreAfter();

			it('can transfer PERI', async () => {
				const user1BalanceBefore = await PeriFinance.balanceOf(user1);
				const user2BalanceBefore = await PeriFinance.balanceOf(user2);

				const amount = toUnit('10');
				const txn = await PeriFinance.transfer(user2, amount, {
					from: user1,
				});

				const receipt = await web3.eth.getTransactionReceipt(txn.tx);
				console.log('Gas on transfer', gasFromReceipt({ receipt }));

				const user1BalanceAfter = await PeriFinance.balanceOf(user1);
				const user2BalanceAfter = await PeriFinance.balanceOf(user2);

				assert.bnEqual(user1BalanceAfter, user1BalanceBefore.sub(amount));
				assert.bnEqual(user2BalanceAfter, user2BalanceBefore.add(amount));
			});
		});

		describe('minting', () => {
			addSnapshotBeforeRestoreAfter();

			before(async () => {
				await writeSetting({
					setting: 'setMinimumStakeTime',
					value: '60',
					network,
					deploymentPath,
				});
			});

			it('can issue pUSD', async () => {
				const user1BalanceBefore = await PynthpUSD.balanceOf(user1);

				const amount = toUnit('10');
				const txn = await PeriFinance.issuePynthsAndStakeUSDC(amount, toUnit('0'), {
					from: user1,
				});
				const receipt = await web3.eth.getTransactionReceipt(txn.tx);
				console.log('Gas on issue', gasFromReceipt({ receipt }));

				const user1BalanceAfter = await PynthpUSD.balanceOf(user1);

				assert.bnEqual(user1BalanceAfter, user1BalanceBefore.add(amount));
			});

			it('can burn pUSD', async () => {
				await skipStakeTime({ network, deploymentPath });

				const user1BalanceBefore = await PynthpUSD.balanceOf(user1);

				const txn = await PeriFinance.burnPynths(user1BalanceBefore, {
					from: user1,
				});

				const receipt = await web3.eth.getTransactionReceipt(txn.tx);
				console.log('Gas on burn', gasFromReceipt({ receipt }));

				const user1BalanceAfter = await PynthpUSD.balanceOf(user1);

				assert.bnLt(user1BalanceAfter, user1BalanceBefore);
			});
		});

		describe('exchanging', () => {
			before('skip if there is no exchanging implementation', async function() {
				if (config.useOvm) {
					this.skip();
				}
			});
			addSnapshotBeforeRestoreAfter();

			it('can exchange pUSD to pETH', async () => {
				await skipWaitingPeriod({ network, deploymentPath });

				const user1BalanceBeforepUSD = await PynthpUSD.balanceOf(user1);
				const user1BalanceBeforepETH = await PynthpETH.balanceOf(user1);

				const amount = toUnit('10');
				const txn = await PeriFinance.exchange(toBytes32('pUSD'), amount, toBytes32('pETH'), {
					from: user1,
				});

				const receipt = await web3.eth.getTransactionReceipt(txn.tx);
				console.log('Gas on exchange', gasFromReceipt({ receipt }));

				const user1BalanceAfterpUSD = await PynthpUSD.balanceOf(user1);
				const user1BalanceAfterpETH = await PynthpETH.balanceOf(user1);

				assert.bnLt(user1BalanceAfterpUSD, user1BalanceBeforepUSD);
				assert.bnGt(user1BalanceAfterpETH, user1BalanceBeforepETH);
			});

			it('can exchange pETH to pUSD', async () => {
				await skipWaitingPeriod({ network, deploymentPath });

				const user1BalanceBeforepUSD = await PynthpUSD.balanceOf(user1);
				const user1BalanceBeforepETH = await PynthpETH.balanceOf(user1);

				const amount = toUnit('1');
				const txn = await PeriFinance.exchange(toBytes32('pETH'), amount, toBytes32('pUSD'), {
					from: user1,
				});

				const receipt = await web3.eth.getTransactionReceipt(txn.tx);
				console.log('Gas on exchange', gasFromReceipt({ receipt }));

				const user1BalanceAfterpUSD = await PynthpUSD.balanceOf(user1);
				const user1BalanceAfterpETH = await PynthpETH.balanceOf(user1);

				assert.bnLt(user1BalanceAfterpETH, user1BalanceBeforepETH);
				assert.bnGt(user1BalanceAfterpUSD, user1BalanceBeforepUSD);
			});
		});
	});

	describe('exchanging with virtual pynths', () => {
		let Exchanger;
		let vPynth;

		const vPynthCreationEvent = txn => {
			const vscEntry = Exchanger.abi.find(({ name }) => name === 'VirtualPynthCreated');
			const log = txn.receipt.rawLogs.find(({ topics }) => topics[0] === vscEntry.signature);

			return web3.eth.abi.decodeLog(vscEntry.inputs, log.data, log.topics.slice(1));
		};

		before(async function() {
			const virtualPynths = await implementsVirtualPynths({ network, deploymentPath });
			if (config.useOvm || !virtualPynths) {
				this.skip();
			}

			await skipWaitingPeriod({ network, deploymentPath });

			Exchanger = await connectContract({
				network,
				deploymentPath,
				contractName: 'Exchanger',
			});

			// // clear out any pending settlements
			await Exchanger.settle(user1, toBytes32('pETH'), { from: user1 });
			await Exchanger.settle(user1, toBytes32('pBTC'), { from: user1 });
		});

		describe('when user exchanges pUSD into pETH using a Virtualynths', () => {
			const amount = toUnit('100');
			let txn;
			let receipt;
			let userBalanceOfpETHBefore;

			before(async () => {
				userBalanceOfpETHBefore = await PynthpETH.balanceOf(user1);

				txn = await PeriFinance.exchangeWithVirtual(
					toBytes32('pUSD'),
					amount,
					toBytes32('pETH'),
					toBytes32(),
					{
						from: user1,
					}
				);

				receipt = await web3.eth.getTransactionReceipt(txn.tx);
				console.log('Gas on exchange', gasFromReceipt({ receipt }));
			});

			it('creates the virtual pynth as expected', async () => {
				const decoded = vPynthCreationEvent(txn);

				vPynth = await artifacts.require('VirtualPynth').at(decoded.vPynth);

				const trimUtf8EscapeChars = input => web3.utils.hexToAscii(web3.utils.utf8ToHex(input));

				assert.equal(trimUtf8EscapeChars(await vPynth.name()), 'Virtual Pynth pETH');
				assert.equal(trimUtf8EscapeChars(await vPynth.symbol()), 'vpETH');

				assert.ok((await vPynth.totalSupply()).toString() > 0);
				assert.ok((await vPynth.balanceOf(user1)).toString() > 0);

				assert.ok(await PynthpETH.balanceOf(vPynth.address), '0');

				assert.ok((await vPynth.secsLeftInWaitingPeriod()) > 0);
				assert.notOk(await vPynth.readyToSettle());
				assert.notOk(await vPynth.settled());
			});

			it('and the vPynth has a single settlement entry', async () => {
				const { numEntries } = await Exchanger.settlementOwing(vPynth.address, toBytes32('pETH'));

				assert.equal(numEntries.toString(), '1');
			});

			it('and the user has no settlement entries', async () => {
				const { numEntries } = await Exchanger.settlementOwing(user1, toBytes32('pETH'));

				assert.equal(numEntries.toString(), '0');
			});

			it('and the user has no more pETH after the exchanage', async () => {
				assert.bnEqual(await PynthpETH.balanceOf(user1), userBalanceOfpETHBefore);
			});

			describe('when the waiting period expires', () => {
				before(async () => {
					await skipWaitingPeriod({ network, deploymentPath });
				});
				it('then the vPynth shows ready for settlement', async () => {
					assert.equal(await vPynth.secsLeftInWaitingPeriod(), '0');
					assert.ok(await vPynth.readyToSettle());
				});
				describe('when settled', () => {
					before(async () => {
						const txn = await vPynth.settle(user1, { from: user1 });
						const receipt = await web3.eth.getTransactionReceipt(txn.tx);

						console.log('Gas on vPynth settlement', gasFromReceipt({ receipt }));
					});
					it('user has more pETH balance', async () => {
						assert.bnGt(await PynthpETH.balanceOf(user1), userBalanceOfpETHBefore);
					});
					it('and the user has no settlement entries', async () => {
						const { numEntries } = await Exchanger.settlementOwing(user1, toBytes32('pETH'));

						assert.equal(numEntries.toString(), '0');
					});
					it('and the vPynth has no settlement entries', async () => {
						const { numEntries } = await Exchanger.settlementOwing(
							vPynth.address,
							toBytes32('pETH')
						);

						assert.equal(numEntries.toString(), '0');
					});
					it('and the vPynth shows settled', async () => {
						assert.equal(await vPynth.settled(), true);
					});
				});
			});
		});

		describe('with virtual tokens and a custom swap contract', () => {
			const usdcHolder = knownAccounts['mainnet'].find(a => a.name === 'binance').address;
			const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
			const wbtc = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';

			before('skip if not on mainnet', async function() {
				if (network !== 'mainnet') {
					this.skip();
				}
			});

			it('using virtual tokens', async () => {
				// deploy SwapWithVirtualPynth
				const swapContract = await artifacts.require('SwapWithVirtualPynth').new();

				console.log('\n\n✅ Deploy SwapWithVirtualPynth at', swapContract.address);

				const WBTC = await artifacts.require('ERC20').at(wbtc);
				const originalWBTCBalance = (await WBTC.balanceOf(usdcHolder)).toString() / 1e8;

				// USDC uses 6 decimals
				const amount = ('10000000' * 1e6).toString();

				const USDC = await artifacts.require('ERC20').at(usdc);

				console.log(
					grey(
						'USDC balance of powned account',
						(await USDC.balanceOf(usdcHolder)).toString() / 1e6
					)
				);

				await USDC.approve(swapContract.address, amount, { from: usdcHolder });

				console.log('✅ User approved swap contract to spend their USDC');

				const txn = await swapContract.usdcToWBTC(amount, { from: usdcHolder });
				const receipt = await web3.eth.getTransactionReceipt(txn.tx);

				console.log(
					'✅ User invokes swap.usdbToWBTC with 10m USDC',
					'Gas',
					red(gasFromReceipt({ receipt }))
				);

				const decoded = vPynthCreationEvent(txn);

				const PynthpBTC = await connectContract({
					network,
					contractName: 'ProxypBTC',
					abiName: 'Pynth',
					alias: 'PynthpBTC',
				});

				vPynth = await artifacts.require('VirtualPynth').at(decoded.vPynth);

				console.log(
					grey(
						await vPynth.name(),
						await vPynth.symbol(),
						decoded.vPynth,
						fromUnit(await vPynth.totalSupply())
					)
				);

				const { vToken: vTokenAddress } = txn.logs[0].args;
				const vToken = await artifacts.require('VirtualToken').at(vTokenAddress);

				console.log(
					grey(
						await vToken.name(),
						await vToken.symbol(),
						vTokenAddress,
						fromUnit(await vToken.totalSupply())
					)
				);

				console.log(
					grey('\t⏩ vPynth.balanceOf(vToken)', fromUnit(await vPynth.balanceOf(vTokenAddress)))
				);

				console.log(
					grey('\t⏩ pBTC.balanceOf(vPynth)', fromUnit(await PynthpBTC.balanceOf(decoded.vPynth)))
				);

				console.log(
					grey('\t⏩ vToken.balanceOf(user)', fromUnit(await vToken.balanceOf(usdcHolder)))
				);

				await skipWaitingPeriod({ network });
				console.log(grey('⏰  Pynth waiting period expires'));

				const settleTxn = await vToken.settle(usdcHolder);

				const settleReceipt = await web3.eth.getTransactionReceipt(settleTxn.tx);

				console.log(
					'✅ Anyone invokes vToken.settle(user)',
					'Gas',
					red(gasFromReceipt({ receipt: settleReceipt }))
				);

				console.log(
					grey('\t⏩ pBTC.balanceOf(vPynth)', fromUnit(await PynthpBTC.balanceOf(decoded.vPynth)))
				);
				console.log(
					grey('\t⏩ pBTC.balanceOf(vToken)', fromUnit(await PynthpBTC.balanceOf(vTokenAddress)))
				);

				console.log(
					grey('\t⏩ vToken.balanceOf(user)', fromUnit(await vToken.balanceOf(usdcHolder)))
				);

				console.log(
					grey(
						'\t⏩ WBTC.balanceOf(vToken)',
						(await WBTC.balanceOf(vTokenAddress)).toString() / 1e8
					)
				);

				console.log(
					grey(
						'\t⏩ WBTC.balanceOf(user)',
						(await WBTC.balanceOf(usdcHolder)).toString() / 1e8 - originalWBTCBalance
					)
				);

				// output log of settlement txn if need be
				// require('fs').writeFileSync(
				// 	'prod-run.log',
				// 	require('util').inspect(settleTxn, false, null, true)
				// );
			});
		});
	});
});
