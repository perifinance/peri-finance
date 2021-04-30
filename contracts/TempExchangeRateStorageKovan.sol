pragma solidity ^0.5.16;

contract TempExchangeRateStorageKovan {
    struct RateAndUpdatedTime {
        uint216 rate;
        uint40 time;
    }
    mapping(bytes32 => RateAndUpdatedTime) public rates;

    function setRate(bytes32 _currencyKey, uint216 _rate) external {
        rates[_currencyKey] = RateAndUpdatedTime(_rate, uint40(block.timestamp));
    }

    function getRate(bytes32 _currencyKey) public view returns (uint216, uint40) {
        return (
            rates[_currencyKey].rate > 0 ? rates[_currencyKey].rate : 10**18,
            rates[_currencyKey].time > 0 ? rates[_currencyKey].time : uint40(block.timestamp)
        );
    }
}