pragma solidity ^0.5.16;

import "./BaseOneNetAggregator.sol";

contract OneNetAggregatorIssuedPynths is BaseOneNetAggregator {
    bytes32 public constant CONTRACT_NAME = "OneNetAggregatorIssuedPynths";

    constructor(AddressResolver _resolver) public BaseOneNetAggregator(_resolver) {}

    function getRoundData(uint80)
        public
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        uint totalIssuedPynths =
            IIssuer(resolver.requireAndGetAddress("Issuer", "aggregate debt info")).totalIssuedPynths("pUSD", true);

        uint dataTimestamp = now;

        if (overrideTimestamp != 0) {
            dataTimestamp = overrideTimestamp;
            
        }

        return (1, int256(totalIssuedPynths), dataTimestamp, dataTimestamp, 1);
    }
}
