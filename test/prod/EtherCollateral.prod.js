const fs = require('fs');
const path = require('path');
const { wrap } = require('../..');
const { contract, config } = require('hardhat');
const { web3 } = require('hardhat');
const { assert } = require('../contracts/common');
const { toUnit } = require('../utils')();
const {
	connectContracts,
	ensureAccountHasEther,
	ensureAccountHaspUSD,
	skipWaitingPeriod,
	simulateExchangeRates,
	takeDebtSnapshot,
	mockOptimismBridge,
	avoidStaleRates,
	resumeSystem,
} = require('./utils');
const { yellow } = require('chalk');

contract('EtherCollateral (prod tests)', accounts => {
	const [, user1] = accounts;

	let owner;

	let network, deploymentPath;

	let EtherCollateral, ReadProxyAddressResolver, Depot;
	let PynthpETH, PynthpUSD;

	before('prepare', async function() {
		network = config.targetNetwork;
		const { getUsers, getPathToNetwork } = wrap({ network, fs, path });
		deploymentPath = config.deploymentPath || getPathToNetwork(network);
		owner = getUsers({ network, user: 'owner' }).address;

		if (config.useOvm) {
			return this.skip();
		}

		await avoidStaleRates({ network, deploymentPath });
		await takeDebtSnapshot({ network, deploymentPath });
		await resumeSystem({ owner, network, deploymentPath });

		if (config.patchFreshDeployment) {
			await simulateExchangeRates({ network, deploymentPath });
			await mockOptimismBridge({ network, deploymentPath });
		}

		({
			EtherCollateral,
			PynthpETH,
			PynthpUSD,
			ReadProxyAddressResolver,
			Depot,
		} = await connectContracts({
			network,
			requests: [
				{ contractName: 'EtherCollateral' },
				{ contractName: 'Depot' },
				{ contractName: 'ReadProxyAddressResolver' },
				{ contractName: 'PynthpETH', abiName: 'Pynth' },
				{ contractName: 'PynthpUSD', abiName: 'Pynth' },
			],
		}));

		await skipWaitingPeriod({ network });

		await ensureAccountHasEther({
			amount: toUnit('1'),
			account: owner,
			fromAccount: accounts[7],
			network,
			deploymentPath,
		});
		await ensureAccountHaspUSD({
			amount: toUnit('1000'),
			account: user1,
			fromAccount: owner,
			network,
			deploymentPath,
		});
	});

	beforeEach('check debt snapshot', async () => {
		await takeDebtSnapshot({ network, deploymentPath });
	});

	describe('misc state', () => {
		it('has the expected resolver set', async () => {
			assert.equal(await EtherCollateral.resolver(), ReadProxyAddressResolver.address);
		});
	});

	describe('opening a loan', () => {
		const amount = toUnit('1');

		let ethBalance, sEthBalance;
		let tx;
		let loanID;

		before('open loan', async function() {
			const totalIssuedPynths = await EtherCollateral.totalIssuedPynths();
			const issueLimit = await EtherCollateral.issueLimit();
			const liquidity = totalIssuedPynths.add(amount);
			if (liquidity.gte(issueLimit)) {
				console.log(yellow(`Not enough liquidity to open loan. Liquidity: ${liquidity}`));

				this.skip();
			}

			ethBalance = await web3.eth.getBalance(user1);
			sEthBalance = await PynthpETH.balanceOf(user1);

			tx = await EtherCollateral.openLoan({
				from: user1,
				value: amount,
			});
		});

		it('produces a valid loan id', async () => {
			({ loanID } = tx.receipt.logs.find(log => log.event === 'LoanCreated').args);

			assert.notEqual(loanID.toString(), '0');
		});

		describe('closing a loan', () => {
			before(async () => {
				if (network === 'local') {
					const amount = toUnit('1000');

					const balance = await PynthpUSD.balanceOf(Depot.address);
					if (balance.lt(amount)) {
						await PynthpUSD.approve(Depot.address, amount, {
							from: user1,
						});

						await Depot.depositPynths(amount, {
							from: user1,
						});
					}
				}

				ethBalance = await web3.eth.getBalance(user1);
				sEthBalance = await PynthpETH.balanceOf(user1);

				await EtherCollateral.closeLoan(loanID, {
					from: user1,
				});
			});

			it('reimburses ETH', async () => {
				assert.bnGt(web3.utils.toBN(await web3.eth.getBalance(user1)), web3.utils.toBN(ethBalance));
			});

			it('deducts pETH', async () => {
				assert.bnLt(await PynthpETH.balanceOf(user1), sEthBalance);
			});
		});
	});
});
