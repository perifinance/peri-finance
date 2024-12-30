'use strict';

const { artifacts, contract, web3 } = require('hardhat');

const { assert, addSnapshotBeforeRestoreAfterEach } = require('./common');

let MultiCollateralPynth;
let CollateralState;

const {
	onlyGivenAddressCanInvoke,
	ensureOnlyExpectedMutativeFunctions,
	setupPriceAggregators,
	updateAggregatorRates,
} = require('./helpers');
const { toUnit, fastForward } = require('../utils')();
const {
	toBytes32,
	constants: { ZERO_ADDRESS },
} = require('../..');

const { setupAllContracts, setupContract } = require('./setup');

contract('MultiCollateralPynth', accounts => {
	const [deployerAccount, owner, , ,validator, account1] = accounts;

	const pETH = toBytes32('pETH');
	const pBTC = toBytes32('pBTC');

	let issuer,
		resolver,
		manager,
		ceth,
		exchangeRates,
		managerState,
		debtCache,
		pUSDPynth,
		feePool,
		pynths;

	const getid = async tx => {
		const event = tx.logs.find(log => log.event === 'LoanCreated');
		return event.args.id;
	};

	const deployCollateral = async ({
		state,
		owner,
		manager,
		resolver,
		collatKey,
		minColat,
		minSize,
	}) => {
		return setupContract({
			accounts,
			contract: 'CollateralEth',
			args: [state, owner, manager, resolver, collatKey, minColat, minSize],
		});
	};

	const issuepUSDToAccount = async (issueAmount, receiver) => {
		// Set up the depositor with an amount of pynths to deposit.
		await pUSDPynth.issue(receiver, issueAmount, {
			from: owner,
		});
	};

	before(async () => {
		MultiCollateralPynth = artifacts.require('MultiCollateralPynth');
		CollateralState = artifacts.require('CollateralState');
	});

	const onlyInternalString = 'Only internal contracts allowed';

	before(async () => {
		pynths = ['pUSD'];
		({
			AddressResolver: resolver,
			Issuer: issuer,
			PynthpUSD: pUSDPynth,
			ExchangeRates: exchangeRates,
			DebtCache: debtCache,
			FeePool: feePool,
			CollateralManager: manager,
			CollateralManagerState: managerState,
			CollateralEth: ceth,
		} = await setupAllContracts({
			accounts,
			pynths,
			contracts: [
				'AddressResolver',
				'PeriFinance',
				'Issuer',
				'ExchangeRates',
				'SystemStatus',
				'Exchanger',
				'FeePool',
				'CollateralManager',
				'CollateralManagerState',
				'CollateralEth',
				'FuturesMarketManager',
			],
		}));

		await setupPriceAggregators(exchangeRates, owner, [pETH, pBTC]);
		await updateAggregatorRates(exchangeRates, null, [pETH, pBTC], [100, 10000].map(toUnit));

		await managerState.setAssociatedContract(manager.address, { from: owner });

		const state = await CollateralState.new(owner, ZERO_ADDRESS, { from: deployerAccount });

		ceth = await deployCollateral({
			state: state.address,
			owner: owner,
			manager: manager.address,
			resolver: resolver.address,
			collatKey: toBytes32('pETH'),
			minColat: toUnit(1.5),
			minSize: toUnit(1),
		});

		await state.setAssociatedContract(ceth.address, { from: owner });

		await resolver.importAddresses(
			[toBytes32('CollateralEth'), toBytes32('CollateralManager')],
			[ceth.address, manager.address],
			{
				from: owner,
			}
		);

		await manager.rebuildCache();
		await feePool.rebuildCache();
		await debtCache.rebuildCache();

		await manager.addCollaterals([ceth.address], { from: owner });

		await issuepUSDToAccount(toUnit(1000), owner);
		await debtCache.takeDebtSnapshot();
	});

	addSnapshotBeforeRestoreAfterEach();

	const deployPynth = async ({ currencyKey, proxy, tokenState }) => {
		// As either of these could be legacy, we require them in the testing context (see buidler.config.js)
		const TokenState = artifacts.require('TokenState');
		const Proxy = artifacts.require('Proxy');

		tokenState =
			tokenState ||
			(await TokenState.new(owner, ZERO_ADDRESS, {
				from: deployerAccount,
			}));

		proxy = proxy || (await Proxy.new(owner, { from: deployerAccount }));

		const pynth = await MultiCollateralPynth.new(
			proxy.address,
			tokenState.address,
			`Pynth${currencyKey}`,
			currencyKey,
			owner,
			toBytes32(currencyKey),
			web3.utils.toWei('0'),
			resolver.address,
			validator,
			{
				from: deployerAccount,
			}
		);

		await resolver.importAddresses([toBytes32(`Pynth${currencyKey}`)], [pynth.address], {
			from: owner,
		});

		await pynth.rebuildCache();
		await manager.rebuildCache();
		await debtCache.rebuildCache();

		await ceth.addPynths([toBytes32(`Pynth${currencyKey}`)], [toBytes32(currencyKey)], {
			from: owner,
		});

		return { pynth, tokenState, proxy };
	};

	describe('when a MultiCollateral pynth is added and connected to PeriFinance', () => {
		beforeEach(async () => {
			const { pynth, tokenState, proxy } = await deployPynth({
				currencyKey: 'sXYZ',
			});
			await tokenState.setAssociatedContract(pynth.address, { from: owner });
			await proxy.setTarget(pynth.address, { from: owner });
			await issuer.addPynth(pynth.address, { from: owner });
			this.pynth = pynth;
			this.pynthViaProxy = await MultiCollateralPynth.at(proxy.address);
		});

		it('ensure only known functions are mutative', () => {
			ensureOnlyExpectedMutativeFunctions({
				abi: this.pynth.abi,
				ignoreParents: ['Pynth'],
				expected: [], // issue and burn are both overridden in MultiCollateral from Pynth
			});
		});

		it('ensure the list of resolver addresses are as expected', async () => {
			const actual = await this.pynth.resolverAddressesRequired();
			assert.deepEqual(
				actual,
				[
					'SystemStatus',
					'Exchanger',
					'Issuer',
					'FeePool',
					'FuturesMarketManager',
					'CollateralManager',
				].map(toBytes32)
			);
		});

		// SIP-238
		describe('implementation does not allow transfer calls (but allows approve)', () => {
			const revertMsg = 'Only the proxy';
			const amount = toUnit('100');
			beforeEach(async () => {
				// approve for transferFrom to work
				await this.pynthViaProxy.approve(account1, amount, { from: owner });
			});
			it('approve does not revert', async () => {
				await this.pynth.approve(account1, amount, { from: owner });
			});
			it('transfer reverts', async () => {
				await assert.revert(this.pynth.transfer(account1, amount, { from: owner }), revertMsg);
			});
			it('transferFrom reverts', async () => {
				await assert.revert(
					this.pynth.transferFrom(owner, account1, amount, { from: account1 }),
					revertMsg
				);
			});
			it('transferAndSettle reverts', async () => {
				await assert.revert(
					this.pynth.transferAndSettle(account1, amount, { from: account1 }),
					revertMsg
				);
			});
			it('transferFromAndSettle reverts', async () => {
				await assert.revert(
					this.pynth.transferFromAndSettle(owner, account1, amount, { from: account1 }),
					revertMsg
				);
			});
		});

		describe('when non-multiCollateral tries to issue', () => {
			it('then it fails', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: this.pynth.issue,
					args: [account1, toUnit('1')],
					accounts,
					reason: 'Only FeePool, Exchanger, Issuer or MultiCollateral contracts allowed',
				});
			});
		});
		describe('when non-multiCollateral tries to burn', () => {
			it('then it fails', async () => {
				await onlyGivenAddressCanInvoke({
					fnc: this.pynth.burn,
					args: [account1, toUnit('1')],
					accounts,
					reason: 'Only FeePool, Exchanger, Issuer or MultiCollateral contracts allowed',
				});
			});
		});

		describe('when multiCollateral is set to the owner', () => {
			beforeEach(async () => {
				const sXYZ = toBytes32('sXYZ');
				await setupPriceAggregators(exchangeRates, owner, [sXYZ]);
				await updateAggregatorRates(exchangeRates, null, [sXYZ], [toUnit(5)]);
			});
			describe('when multiCollateral tries to issue', () => {
				it('then it can issue new pynths', async () => {
					const accountToIssue = account1;
					const issueAmount = toUnit('1');
					const totalSupplyBefore = await this.pynth.totalSupply();
					const balanceOfBefore = await this.pynth.balanceOf(accountToIssue);

					await ceth.open(issueAmount, toBytes32('sXYZ'), { value: toUnit(2), from: account1 });

					assert.bnEqual(await this.pynth.totalSupply(), totalSupplyBefore.add(issueAmount));
					assert.bnEqual(
						await this.pynth.balanceOf(accountToIssue),
						balanceOfBefore.add(issueAmount)
					);
				});
			});
			describe('when multiCollateral tries to burn', () => {
				it('then it can burn pynths', async () => {
					const totalSupplyBefore = await this.pynth.totalSupply();
					const balanceOfBefore = await this.pynth.balanceOf(account1);
					const amount = toUnit('5');

					const tx = await ceth.open(amount, toBytes32('sXYZ'), {
						value: toUnit(2),
						from: account1,
					});

					const id = await getid(tx);

					await fastForward(300);

					assert.bnEqual(await this.pynth.totalSupply(), totalSupplyBefore.add(amount));
					assert.bnEqual(await this.pynth.balanceOf(account1), balanceOfBefore.add(amount));

					await ceth.repay(account1, id, toUnit(3), { from: account1 });

					assert.bnEqual(await this.pynth.totalSupply(), toUnit(2));
					assert.bnEqual(await this.pynth.balanceOf(account1), toUnit(2));
				});
			});

			describe('when periFinance set to account1', () => {
				const accountToIssue = account1;
				const issueAmount = toUnit('1');

				beforeEach(async () => {
					// have account1 simulate being Issuer so we can invoke issue and burn
					await resolver.importAddresses([toBytes32('Issuer')], [accountToIssue], { from: owner });
					// now have the pynth resync its cache
					await this.pynth.rebuildCache();
				});

				it('then it can issue new pynths as account1', async () => {
					const totalSupplyBefore = await this.pynth.totalSupply();
					const balanceOfBefore = await this.pynth.balanceOf(accountToIssue);

					await this.pynth.issue(accountToIssue, issueAmount, { from: accountToIssue });

					assert.bnEqual(await this.pynth.totalSupply(), totalSupplyBefore.add(issueAmount));
					assert.bnEqual(
						await this.pynth.balanceOf(accountToIssue),
						balanceOfBefore.add(issueAmount)
					);
				});
			});
		});
	});
});
