pragma solidity 0.5.16;

import "./Owned.sol";

contract BlacklistManager is Owned {
    mapping(address => bool) public flagged;

    address[] public listedAddresses;

    constructor(address _owner) public Owned(_owner) {}

    function flagAccount(address _account) external onlyOwner {
        flagged[_account] = true;

        bool checker = false;
        for (uint i = 0; i < listedAddresses.length; i++) {
            if (listedAddresses[i] == _account) {
                checker = true;

                break;
            }
        }

        if (!checker) {
            listedAddresses.push(_account);
        }

        emit Blacklisted(_account);
    }

    function unflagAccount(address _account) external onlyOwner {
        flagged[_account] = false;

        emit Unblacklisted(_account);
    }

    function getAddresses() external view returns (address[] memory) {
        return listedAddresses;
    }

    event Blacklisted(address indexed account);
    event Unblacklisted(address indexed account);
}
