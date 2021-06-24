pragma solidity ^0.5.16;

import "./Owned.sol";

contract ExternalRateAggregator is Owned {
    address public oracle;

    uint private constant ORACLE_FUTURE_LIMIT = 10 minutes;

    struct RateAndUpdatedTime {
        uint216 rate;
        uint40 time;
    }

    mapping(bytes32 => RateAndUpdatedTime) public rates;

    constructor(address _owner, address _oracle) public Owned(_owner) {
        oracle = _oracle;
    }

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Address cannot be empty");

        oracle = _oracle;
    }

    function updateRates(
        bytes32[] calldata _currencyKeys,
        uint216[] calldata _newRates,
        uint timeSent
    ) external onlyOracle {
        require(_currencyKeys.length == _newRates.length, "Currency key array length must match rates array length.");
        require(timeSent < (now + ORACLE_FUTURE_LIMIT), "Time is too far into the future");

        for (uint i = 0; i < _currencyKeys.length; i++) {
            bytes32 currencyKey = _currencyKeys[i];
            uint newRate = _newRates[i];

            require(newRate != 0, "Zero is not a valid rate, please call deleteRate instead");
            require(currencyKey != "pUSD", "Rate of pUSD cannot be updated, it's always UNIT");

            if (timeSent < rates[currencyKey].time) {
                continue;
            }

            rates[currencyKey] = RateAndUpdatedTime({rate: uint216(newRate), time: uint40(timeSent)});
        }

        emit RatesUpdated(_currencyKeys, _newRates);
    }

    function deleteRate(bytes32 _currencyKey) external onlyOracle {
        delete rates[_currencyKey];
    }

    function getRateAndUpdatedTime(bytes32 _currencyKey) external view returns (uint, uint) {
        return (rates[_currencyKey].rate, rates[_currencyKey].time);
    }

    modifier onlyOracle {
        _onlyOracle();
        _;
    }

    function _onlyOracle() private view {
        require(msg.sender == oracle, "Only the oracle can perform this action");
    }

    event RatesUpdated(bytes32[] currencyKeys, uint216[] newRates);
}
