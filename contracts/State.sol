pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";

// https://docs.peri.finance/contracts/source/contracts/state
contract State is Owned {
    // the address of the contract that can modify variables
    // this can only be changed by the owner of this contract
    address public associatedContract;

    constructor(address _associatedContract) internal {
        // This contract is abstract, and thus cannot be instantiated directly
        require(owner != address(0), "Owner must be set");

        associatedContract = _associatedContract;
        emit AssociatedContractUpdated(_associatedContract);
    }

    /* ========== SETTERS ========== */

    // Change the associated contract to a new address
    function setAssociatedContract(address _associatedContract) external onlyOwner {
        associatedContract = _associatedContract;
        emit AssociatedContractUpdated(_associatedContract);
    }

    /* ========== MODIFIERS ========== */

    modifier onlyAssociatedContract {
        string memory message = concatenateStrings("Only the associated contract can perform this action", addressToString(msg.sender)) ;
        require(msg.sender == associatedContract, message);
        //require(msg.sender == associatedContract, "Only the associated contract can perform this action");
        _;
    }

    modifier onlyAssociatedContract1 {
        string memory message = concatenateStrings("1Only the associated contract can perform this action", addressToString(msg.sender)) ;
        require(msg.sender == associatedContract, message);
        //require(msg.sender == associatedContract, "Only the associated contract can perform this action");
        _;
    }

    modifier onlyAssociatedContract2 {
        string memory message = concatenateStrings("2Only the associated contract can perform this action", addressToString(msg.sender)) ;
        require(msg.sender == associatedContract, message);
        //require(msg.sender == associatedContract, "Only the associated contract can perform this action");
        _;
    }

    function concatenateStrings(string memory a, string memory b) public pure returns (string memory) {
        bytes memory concatenatedBytes = abi.encodePacked(a, b);
        return string(concatenatedBytes);
    }

    function addressToString(address _pool) public pure returns (string memory _uintAsString) {
      uint _i = uint256(_pool);
      if (_i == 0) {
          return "0";
      }
      uint j = _i;
      uint len;
      while (j != 0) {
          len++;
          j /= 10;
      }
      bytes memory bstr = new bytes(len);
      uint k = len - 1;
      while (_i != 0) {
          bstr[k--] = byte(uint8(48 + _i % 10));
          _i /= 10;
      }
      return string(bstr);
    }


    /* ========== EVENTS ========== */

    event AssociatedContractUpdated(address associatedContract);
}
