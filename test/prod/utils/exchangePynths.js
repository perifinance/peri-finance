const { toBytes32 } = require('../../..');
const { connectContract, connectContracts } = require('./connectContract');
const { getDecodedLogs } = require('../../contracts/helpers');

async function getExchangeLogsWithTradingRewards({ network, deploymentPath, exchangeTx }) {
	const { TradingRewards, PeriFinance } = await connectContracts({
		network,
		deploymentPath,
		requests: [{ contractName: 'TradingRewards' }, { contractName: 'PeriFinance' }],
	});

	const logs = await getDecodedLogs({
		hash: exchangeTx.tx,
		contracts: [PeriFinance, TradingRewards],
	});

	return logs.filter(log => log !== undefined);
}

async function getExchangeLogs({ network, deploymentPath, exchangeTx }) {
	const PeriFinance = await connectContract({
		network,
		deploymentPath,
		contractName: 'ProxyERC20',
		abiName: 'PeriFinance',
	});

	const logs = await getDecodedLogs({
		hash: exchangeTx.tx,
		contracts: [PeriFinance],
	});

	return logs.filter(log => log !== undefined);
}

async function exchangePynths({
	network,
	deploymentPath,
	account,
	fromCurrency,
	toCurrency,
	amount,
	withTradingRewards = false,
}) {
	const PeriFinance = await connectContract({
		network,
		deploymentPath,
		contractName: 'ProxyERC20',
		abiName: 'PeriFinance',
	});

	const exchangeTx = await PeriFinance.exchange(
		toBytes32(fromCurrency),
		amount,
		toBytes32(toCurrency),
		{
			from: account,
		}
	);

	let exchangeLogs;
	if (withTradingRewards) {
		exchangeLogs = await getExchangeLogsWithTradingRewards({ network, deploymentPath, exchangeTx });
	} else {
		exchangeLogs = await getExchangeLogs({ network, deploymentPath, exchangeTx });
	}

	return { exchangeTx, exchangeLogs };
}

module.exports = {
	exchangePynths,
};
