const { web3 } = require('hardhat');
const { connectContract } = require('./connectContract');

async function implementsVirtualPynths({ network, deploymentPath }) {
	const PeriFinance = await connectContract({
		network,
		deploymentPath,
		contractName: 'PeriFinance',
	});

	const code = await web3.eth.getCode(PeriFinance.address);
	const sighash = web3.eth.abi
		.encodeFunctionSignature('exchangeWithVirtual(bytes32,uint256,bytes32,bytes32)')
		.slice(2, 10);

	return code.includes(sighash);
}

module.exports = {
	implementsVirtualPynths,
};
