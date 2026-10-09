import pytest
from leadhunter_worker.visual_audit import validate_review, public_url


def test_visual_findings_cannot_reference_unseen_images():
    with pytest.raises(ValueError):
        validate_review({"status": "assessed", "confidence": 90, "summary": "Review", "issues": [{
            "category": "overlap", "severity": "material", "confidence": 90, "screenshotId": "invented",
            "element": "Header", "observation": "Covers text", "impact": "Cannot read title",
        }]}, {"desktop_top", "mobile_top"})


def test_review_does_not_guess_when_page_is_blocked():
    review = validate_review({"status": "unavailable", "confidence": 0, "summary": "Captcha", "issues": []}, {"desktop_top"})
    assert review["status"] == "unavailable"


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://169.254.169.254/", "file:///etc/passwd", "https://user:secret@example.com/"])
def test_browser_blocks_private_or_credential_urls(url):
    assert not public_url(url)
