'use strict';

const { artifacts, contract } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

const { fastForward, toUnit, fromUnit, currentTime } = require('../utils')();

const { setupAllContracts, setupContract } = require('./setup');

const { ensureOnlyExpectedMutativeFunctions } = require('./helpers');

const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../..');

let CollateralManager;
let CollateralState;
let CollateralManagerState;

contract('CollateralShort', async accounts => {
	const YEAR = 31556926;

	const pUSD = toBytes32('pUSD');
	const pETH = toBytes32('pETH');
	const pBTC = toBytes32('pBTC');

	const [deployerAccount, owner, oracle, , account1, account2] = accounts;

	let short,
		state,
		managerState,
		feePool,
		exchangeRates,
		addressResolver,
		pUSDPynth,
		pBTCPynth,
		pETHPynth,
		iBTCPynth,
		iETHPynth,
		pynths,
		manager,
		issuer,
		debtCache;

	let tx, loan, id;

	const getid = tx => {
		const event = tx.logs.find(log => log.event === 'LoanCreated');
		return event.args.id;
	};

	const fastForwardAndUpdateRates = async seconds => {
		await fastForward(seconds);
		await updateRatesWithDefaults();
	};

	const issue = async (pynth, issueAmount, receiver) => {
		await pynth.issue(receiver, issueAmount, { from: owner });
	};

	const updateRatesWithDefaults = async () => {
		const timestamp = await currentTime();

		await exchangeRates.updateRates([pETH], ['100'].map(toUnit), timestamp, {
			from: oracle,
		});

		const pBTC = toBytes32('pBTC');

		await exchangeRates.updateRates([pBTC], ['10000'].map(toUnit), timestamp, {
			from: oracle,
		});
	};

	const deployShort = async ({ state, owner, manager, resolver, collatKey, minColat, minSize }) => {
		return setupContract({
			accounts,
			contract: 'CollateralShort',
			args: [state, owner, manager, resolver, collatKey, minColat, minSize],
		});
	};

	const setupShort = async () => {
		pynths = ['pUSD', 'pBTC', 'pETH', 'iBTC', 'iETH'];
		({
			ExchangeRates: exchangeRates,
			PynthpUSD: pUSDPynth,
			PynthpBTC: pBTCPynth,
			PynthpETH: pETHPynth,
			PynthiBTC: iBTCPynth,
			PynthiETH: iETHPynth,
			FeePool: feePool,
			AddressResolver: addressResolver,
			Issuer: issuer,
			DebtCache: debtCache,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'PeriFinance',
				'FeePool',
				'AddressResolver',
				'Exchanger',
				'ExchangeRates',
				'SystemStatus',
				'Issuer',
				'DebtCache',
				'StakingState',
			],
		}));

		managerState = await CollateralManagerState.new(owner, ZERO_ADDRESS, { from: deployerAccount });

		const maxDebt = toUnit(10000000);

		manager = await CollateralManager.new(
			managerState.address,
			owner,
			addressResolver.address,
			maxDebt,
			// 5% / 31536000 (seconds in common year)
			1585489599,
			0,
			{
				from: deployerAccount,
			}
		);

		await managerState.setAssociatedContract(manager.address, { from: owner });

		state = await CollateralState.new(owner, ZERO_ADDRESS, { from: deployerAccount });

		short = await deployShort({
			state: state.address,
			owner: owner,
			manager: manager.address,
			resolver: addressResolver.address,
			collatKey: pUSD,
			minColat: toUnit(1.2),
			minSize: toUnit(0.1),
		});

		await state.setAssociatedContract(short.address, { from: owner });

		await addressResolver.importAddresses(
			[toBytes32('CollateralShort'), toBytes32('CollateralManager')],
			[short.address, manager.address],
			{
				from: owner,
			}
		);

		await feePool.rebuildCache();
		await manager.rebuildCache();
		await issuer.rebuildCache();
		await debtCache.rebuildCache();

		await manager.addCollaterals([short.address], { from: owner });

		await short.addPynths(
			['PynthpBTC', 'PynthpETH'].map(toBytes32),
			['pBTC', 'pETH'].map(toBytes32),
			{ from: owner }
		);

		await manager.addShortablePynths(
			[
				[toBytes32('PynthpBTC'), toBytes32('PynthiBTC')],
				[toBytes32('PynthpETH'), toBytes32('PynthiETH')],
			],
			['pBTC', 'pETH'].map(toBytes32),
			{
				from: owner,
			}
		);

		await pUSDPynth.approve(short.address, toUnit(100000), { from: account1 });
	};

	before(async () => {
		CollateralManager = artifacts.require(`CollateralManager`);
		CollateralState = artifacts.require(`CollateralState`);
		CollateralManagerState = artifacts.require('CollateralManagerState');

		await setupShort();
	});

	addSnapshotBeforeRestoreAfterEach();

	beforeEach(async () => {
		await updateRatesWithDefaults();

		await issue(pUSDPynth, toUnit(100000), owner);
		await issue(pBTCPynth, toUnit(1), owner);
		await issue(pETHPynth, toUnit(1), owner);
		await issue(iBTCPynth, toUnit(1), owner);
		await issue(iETHPynth, toUnit(1), owner);

		// The market is balanced between long and short.

		await debtCache.takeDebtSnapshot();
	});

	it('should set constructor params on deployment', async () => {
		assert.equal(await short.state(), state.address);
		assert.equal(await short.owner(), owner);
		assert.equal(await short.resolver(), addressResolver.address);
		assert.equal(await short.collateralKey(), pUSD);
		assert.equal(await short.pynths(0), toBytes32('PynthpBTC'));
		assert.equal(await short.pynths(1), toBytes32('PynthpETH'));
		assert.bnEqual(await short.minCratio(), toUnit(1.2));
	});

	it('should ensure only expected functions are mutative', async () => {
		ensureOnlyExpectedMutativeFunctions({
			abi: short.abi,
			ignoreParents: ['Owned', 'Pausable', 'MixinResolver', 'Proxy', 'Collateral'],
			expected: ['open', 'close', 'deposit', 'repay', 'withdraw', 'liquidate', 'draw', 'getReward'],
		});
	});

	it('should access its dependencies via the address resolver', async () => {
		assert.equal(await addressResolver.getAddress(toBytes32('PynthpUSD')), pUSDPynth.address);
		assert.equal(await addressResolver.getAddress(toBytes32('FeePool')), feePool.address);
		assert.equal(
			await addressResolver.getAddress(toBytes32('ExchangeRates')),
			exchangeRates.address
		);
	});

	describe('opening shorts', async () => {
		describe('should open a btc short', async () => {
			const oneBTC = toUnit(1);
			const pusdCollateral = toUnit(15000);

			beforeEach(async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				tx = await short.open(pusdCollateral, oneBTC, pBTC, { from: account1 });

				id = getid(tx);

				loan = await state.getLoan(account1, id);
			});

			it('should emit the event properly', async () => {
				assert.eventEqual(tx, 'LoanCreated', {
					account: account1,
					id: id,
					amount: oneBTC,
					collateral: pusdCollateral,
					currency: pBTC,
				});
			});

			it('should create the short correctly', async () => {
				assert.equal(loan.account, account1);
				assert.equal(loan.collateral, pusdCollateral.toString());
				assert.equal(loan.currency, pBTC);
				assert.equal(loan.short, true);
				assert.equal(loan.amount, oneBTC.toString());
				assert.equal(loan.accruedInterest, toUnit(0));
			});

			it('should correclty issue the right balance to the shorter', async () => {
				const pUSDProceeds = toUnit(10000);

				assert.bnEqual(await pUSDPynth.balanceOf(account1), pUSDProceeds);
			});

			it('should tell the manager about the short', async () => {
				assert.bnEqual(await manager.short(pBTC), oneBTC);
			});

			it('should transfer the pUSD to the contract', async () => {
				assert.bnEqual(await pUSDPynth.balanceOf(short.address), pusdCollateral);
			});
		});

		describe('should open an eth short', async () => {
			const oneETH = toUnit(1);
			const pusdCollateral = toUnit(1000);

			beforeEach(async () => {
				await issue(pUSDPynth, pusdCollateral, account1);

				tx = await short.open(pusdCollateral, oneETH, pETH, { from: account1 });

				id = getid(tx);

				loan = await state.getLoan(account1, id);
			});

			it('should emit the event properly', async () => {
				assert.eventEqual(tx, 'LoanCreated', {
					account: account1,
					id: id,
					amount: oneETH,
					collateral: pusdCollateral,
					currency: pETH,
				});
			});

			it('should create the short correctly', async () => {
				assert.equal(loan.account, account1);
				assert.equal(loan.collateral, pusdCollateral.toString());
				assert.equal(loan.currency, pETH);
				assert.equal(loan.short, true);
				assert.equal(loan.amount, oneETH.toString());
				assert.equal(loan.accruedInterest, toUnit(0));
			});

			it('should correclty issue the right balance to the shorter', async () => {
				const pUSDProceeds = toUnit(100);

				assert.bnEqual(await pUSDPynth.balanceOf(account1), pUSDProceeds);
			});

			it('should tell the manager about the short', async () => {
				assert.bnEqual(await manager.short(pETH), oneETH);
			});
		});
	});

	describe('Drawing shorts', async () => {
		const oneETH = toUnit(1);
		const pusdCollateral = toUnit(1000);

		beforeEach(async () => {
			await issue(pUSDPynth, pusdCollateral, account1);

			tx = await short.open(pusdCollateral, oneETH, pETH, { from: account1 });

			id = getid(tx);

			await fastForwardAndUpdateRates(3600);

			await short.draw(id, toUnit(5), { from: account1 });
		});

		it('should update the loan', async () => {
			loan = await state.getLoan(account1, id);
			assert.equal(loan.amount, toUnit(6).toString());
		});

		it('should transfer the proceeds to the user', async () => {
			assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(600));
		});

		it('should not let them draw too much', async () => {
			await fastForwardAndUpdateRates(3600);
			await assert.revert(short.draw(id, toUnit(8), { from: account1 }), 'Cannot draw this much');
		});
	});

	describe('Closing shorts', async () => {
		const oneETH = toUnit(1);
		const pusdCollateral = toUnit(1000);

		it('if the eth price goes down, the shorter makes profit', async () => {
			await issue(pUSDPynth, pusdCollateral, account1);

			tx = await short.open(toUnit(500), oneETH, pETH, { from: account1 });

			id = getid(tx);

			await fastForwardAndUpdateRates(3600);

			const timestamp = await currentTime();
			await exchangeRates.updateRates([pETH], ['50'].map(toUnit), timestamp, {
				from: oracle,
			});

			// simulate buying pETH for 50 susd.
			await pUSDPynth.transfer(owner, toUnit(50), { from: account1 });
			await issue(pETHPynth, oneETH, account1);

			// now close the short
			await short.close(id, { from: account1 });

			// shorter has made 50 pUSD profit
			assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(1050));
		});

		it('if the eth price goes up, the shorter makes a loss', async () => {
			await issue(pUSDPynth, pusdCollateral, account1);

			tx = await short.open(toUnit(500), oneETH, pETH, { from: account1 });

			id = getid(tx);

			await fastForwardAndUpdateRates(3600);

			const timestamp = await currentTime();
			await exchangeRates.updateRates([pETH], ['150'].map(toUnit), timestamp, {
				from: oracle,
			});

			// simulate buying pETH for 150 susd.
			await pUSDPynth.transfer(owner, toUnit(150), { from: account1 });
			await issue(pETHPynth, oneETH, account1);

			// now close the short
			await short.close(id, { from: account1 });

			// shorter has made 50 pUSD loss
			assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(950));
		});
	});

	describe('Liquidating shorts', async () => {
		const oneETH = toUnit(1);
		const pusdCollateral = toUnit('130');
		const expectedCollateralRemaining = toUnit('108.000000000000000143');
		const expectedCollateralLiquidated = toUnit('21.999999999999999857');
		const expectedLiquidationAmount = toUnit('0.181818181818181817');
		const expectedLoanRemaining = toUnit('0.818181818181818183');

		beforeEach(async () => {
			await issue(pUSDPynth, pusdCollateral, account1);

			tx = await short.open(pusdCollateral, oneETH, pETH, { from: account1 });

			id = getid(tx);
			await fastForwardAndUpdateRates(3600);
		});

		it('liquidation should be capped to only fix the c ratio', async () => {
			const timestamp = await currentTime();
			await exchangeRates.updateRates([pETH], ['110'].map(toUnit), timestamp, {
				from: oracle,
			});

			// When the ETH price increases 10% to $110, the short
			// which started at 130% should allow 0.18 ETH
			// to be liquidated to restore its c ratio and no more.

			await issue(pETHPynth, oneETH, account2);

			tx = await short.liquidate(account1, id, oneETH, { from: account2 });

			assert.eventEqual(tx, 'LoanPartiallyLiquidated', {
				account: account1,
				id: id,
				liquidator: account2,
				amountLiquidated: expectedLiquidationAmount,
				collateralLiquidated: expectedCollateralLiquidated,
			});

			loan = await state.getLoan(account1, id);

			assert.bnEqual(loan.amount, expectedLoanRemaining);
			assert.bnEqual(loan.collateral, expectedCollateralRemaining);

			const ratio = await short.collateralRatio(loan);

			assert.bnClose(ratio, await short.minCratio(), '100');
		});
	});

	describe('System debt', async () => {
		const oneETH = toUnit(1);
		const twoETH = toUnit(2);
		const pusdCollateral = toUnit(1000);

		it('If there is 1 ETH and 1 short ETH, then the system debt is constant before and after a price change', async () => {
			await issue(pUSDPynth, pusdCollateral, account1);

			await debtCache.takeDebtSnapshot();
			let result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111100));

			tx = await short.open(toUnit(500), oneETH, pETH, { from: account1 });

			id = getid(tx);

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111100));

			await fastForwardAndUpdateRates(3600);

			const timestamp = await currentTime();
			await exchangeRates.updateRates([pETH], ['150'].map(toUnit), timestamp, {
				from: oracle,
			});

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111100));

			// simulate buying pETH for 150 susd.
			await pUSDPynth.burn(account1, toUnit(150));
			await issue(pETHPynth, oneETH, account1);

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111100));

			// now close the short
			await short.close(id, { from: account1 });

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111100));

			// shorter has made 50 pUSD loss
			assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(950));
		});

		it('If there is 1 ETH and 2 short ETH, then the system debt decreases if the price goes up', async () => {
			await issue(pUSDPynth, pusdCollateral, account1);

			await debtCache.takeDebtSnapshot();
			let result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111100));

			tx = await short.open(toUnit(500), twoETH, pETH, { from: account1 });

			id = getid(tx);

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111100));

			await fastForwardAndUpdateRates(3600);

			const timestamp = await currentTime();
			await exchangeRates.updateRates([pETH], ['150'].map(toUnit), timestamp, {
				from: oracle,
			});

			// 111100 + 50 - (2 * 50) = 111,050

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111050));

			// simulate buying 2 pETH for 300 susd.
			await pUSDPynth.burn(account1, toUnit(300));
			await issue(pETHPynth, twoETH, account1);

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111050));

			// now close the short
			await short.close(id, { from: account1 });

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111050));

			// shorter has made 50 pUSD loss
			assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(900));
		});

		it('If there is 1 ETH and 2 short ETH, then the system debt increases if the price goes down', async () => {
			await issue(pUSDPynth, pusdCollateral, account1);

			await debtCache.takeDebtSnapshot();
			let result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111100));

			tx = await short.open(toUnit(500), twoETH, pETH, { from: account1 });

			id = getid(tx);

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111100));

			await fastForwardAndUpdateRates(3600);

			const timestamp = await currentTime();
			await exchangeRates.updateRates([pETH], ['50'].map(toUnit), timestamp, {
				from: oracle,
			});

			// 111100 - 50 + (2 * 50) = 111,150

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111150));

			// simulate buying 2 pETH for 100 susd.
			await pUSDPynth.burn(account1, toUnit(100));
			await issue(pETHPynth, twoETH, account1);

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111150));

			// now close the short
			await short.close(id, { from: account1 });

			await debtCache.takeDebtSnapshot();
			result = await debtCache.cachedDebt();
			assert.bnEqual(result, toUnit(111150));

			// shorter has made 100 pUSD profit
			assert.bnEqual(await pUSDPynth.balanceOf(account1), toUnit(1100));
		});
	});

	describe('Determining the skew and interest rate', async () => {
		it('should correctly determine the interest on a short', async () => {
			const oneBTC = toUnit(1);
			const pusdCollateral = toUnit(15000);

			await issue(pUSDPynth, pusdCollateral, account1);

			tx = await short.open(pusdCollateral, oneBTC, pBTC, { from: account1 });
			id = getid(tx);

			// after a year we should have accrued 33%.

			await fastForwardAndUpdateRates(YEAR);

			// deposit some collateral to trigger the interest accrual.

			tx = await short.deposit(account1, id, toUnit(1), { from: account1 });

			loan = await state.getLoan(account1, id);

			let interest = Math.round(parseFloat(fromUnit(loan.accruedInterest)) * 10000) / 10000;

			assert.equal(interest, 0.3333);

			await fastForwardAndUpdateRates(3600);

			tx = await short.deposit(account1, id, toUnit(1), { from: account1 });

			// after two years we should have accrued about 66%, give or take the 5 minutes we skipped.

			await fastForwardAndUpdateRates(YEAR);

			// deposit some collateral to trigger the interest accrual.

			tx = await short.deposit(account1, id, toUnit(1), { from: account1 });

			loan = await state.getLoan(account1, id);

			interest = Math.round(parseFloat(fromUnit(loan.accruedInterest)) * 10000) / 10000;

			assert.equal(interest, 0.6667);
		});
	});
});
