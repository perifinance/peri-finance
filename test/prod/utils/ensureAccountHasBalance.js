const fs = require('fs');
const path = require('path');
const { connectContract } = require('./connectContract');
const { web3 } = require('hardhat');
const { toBN } = web3.utils;
const { knownAccounts, wrap, toBytes32 } = require('../../..');
const { toUnit } = require('../../utils')();

const { gray } = require('chalk');

const knownMainnetAccount = knownAccounts['mainnet'].find(a => a.name === 'binance').address;

function getUser({ network, deploymentPath, user }) {
	const { getUsers } = wrap({ network, deploymentPath, fs, path });

	return getUsers({ user }).address;
}

async function ensureAccountHasEther({ network, deploymentPath, amount, account }) {
	const currentBalance = web3.utils.toBN(await web3.eth.getBalance(account));
	if (currentBalance.gte(amount)) {
		return;
	}

	console.log(gray(`    > Ensuring ${account} has Ether...`));

	const fromAccount =
		network === 'mainnet'
			? knownMainnetAccount
			: getUser({ network, deploymentPath, user: 'owner' });

	const balance = toBN(await web3.eth.getBalance(fromAccount));
	if (balance.lt(amount)) {
		throw new Error(
			`Account ${fromAccount} only has ${balance} ETH and cannot transfer ${amount} ETH to ${account} `
		);
	}

	await web3.eth.sendTransaction({
		from: fromAccount,
		to: account,
		value: amount,
	});
}

async function ensureAccountHasPERI({ network, deploymentPath, amount, account }) {
	const PERI = await connectContract({ network, deploymentPath, contractName: 'ProxyERC20' });
	if ((await PERI.balanceOf(account)).gte(amount)) {
		return;
	}

	console.log(gray(`    > Ensuring ${account} has PERI...`));

	const fromAccount =
		network === 'mainnet'
			? knownMainnetAccount
			: getUser({
					network,
					deploymentPath,
					user: 'owner',
			  });

	const balance = toBN(await PERI.balanceOf(fromAccount));
	if (balance.lt(amount)) {
		throw new Error(
			`Account ${fromAccount} only has ${balance} PERI and cannot transfer ${amount} PERI to ${account} `
		);
	}

	await PERI.transfer(account, amount, {
		from: fromAccount,
	});
}

async function ensureAccountHaspUSD({ network, deploymentPath, amount, account }) {
	const pUSD = await connectContract({
		network,
		deploymentPath,
		contractName: 'PynthpUSD',
		abiName: 'Pynth',
	});
	if ((await pUSD.balanceOf(account)).gte(amount)) {
		return;
	}

	console.log(gray(`    > Ensuring ${account} has pUSD...`));

	const fromAccount =
		network === 'mainnet'
			? knownMainnetAccount
			: getUser({
					network,
					deploymentPath,
					user: 'owner',
			  });

	const balance = toBN(await pUSD.transferablePynths(fromAccount));
	const periToTransfer = amount.mul(toBN(20));
	if (balance.lt(amount)) {
		await ensureAccountHasPERI({
			network,
			deploymentPath,
			account,
			amount: periToTransfer,
		});

		const PeriFinance = await connectContract({
			network,
			deploymentPath,
			contractName: 'ProxyERC20',
			abiName: 'PeriFinance',
		});

		await PeriFinance.issuePynthsAndStakeUSDC(amount, toUnit('0'), {
			from: account,
		});
	} else {
		await pUSD.transferAndSettle(account, amount, { from: fromAccount });
	}
}

async function ensureAccountHaspETH({ network, deploymentPath, amount, account }) {
	const pETH = await connectContract({
		network,
		deploymentPath,
		contractName: 'PynthpETH',
		abiName: 'Pynth',
	});
	if ((await pETH.balanceOf(account)).gte(amount)) {
		return;
	}

	console.log(gray(`    > Ensuring ${account} has pETH...`));

	const pUSDAmount = amount.mul(toBN('50'));
	await ensureAccountHaspUSD({ network, deploymentPath, amount: pUSDAmount, account });

	const PeriFinance = await connectContract({
		network,
		deploymentPath,
		contractName: 'ProxyERC20',
		abiName: 'PeriFinance',
	});

	await PeriFinance.exchange(toBytes32('pUSD'), pUSDAmount, toBytes32('pETH'), {
		from: account,
	});
}

module.exports = {
	ensureAccountHasEther,
	ensureAccountHaspUSD,
	ensureAccountHaspETH,
	ensureAccountHasPERI,
};
