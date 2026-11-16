"""Private R2 storage for task-linked report files."""

import os
import re
from functools import lru_cache


class StorageUnavailable(OSError):
    """An object store operation could not be completed."""


def configured_backend() -> str:
    backend = os.environ.get("VALUX_REPORT_STORAGE", "local")
    if backend not in {"local", "object"}:
        raise RuntimeError("VALUX_REPORT_STORAGE must be local or object.")
    return backend


@lru_cache(maxsize=1)
def _bucket():
    import boto3
    from botocore.config import Config

    endpoint = os.environ.get("R2_ENDPOINT_URL", "")
    bucket = os.environ.get("R2_BUCKET", "")
    key_id = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    if not re.fullmatch(r"https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com", endpoint):
        raise RuntimeError("R2_ENDPOINT_URL must be an HTTPS Cloudflare R2 account endpoint.")
    if not all((bucket, key_id, secret)):
        raise RuntimeError("R2_BUCKET and both R2 credentials are required.")
    client = boto3.session.Session().client(
        "s3", endpoint_url=endpoint, region_name="auto",
        aws_access_key_id=key_id, aws_secret_access_key=secret,
        config=Config(connect_timeout=5, read_timeout=30, retries={"total_max_attempts": 3, "mode": "standard"},
                      request_checksum_calculation="when_required", response_checksum_validation="when_required"),
    )
    return client, bucket


def _request(operation: str, key: str, **kwargs):
    from botocore.exceptions import BotoCoreError, ClientError

    client, bucket = _bucket()
    try:
        return getattr(client, operation)(Bucket=bucket, Key=key, **kwargs)
    except ClientError as error:
        if operation == "get_object" and error.response.get("Error", {}).get("Code") in {"NoSuchKey", "NotFound", "404"}:
            raise FileNotFoundError from None
        raise StorageUnavailable("The report storage service could not complete the request.") from None
    except BotoCoreError:
        raise StorageUnavailable("The report storage service could not complete the request.") from None


def write(key: str, content: bytes, content_type: str) -> None:
    _request("put_object", key, Body=content, ContentType=content_type)


def read(key: str, expected_size: int) -> bytes:
    from botocore.exceptions import BotoCoreError

    try:
        with _request("get_object", key)["Body"] as body:
            content = body.read(expected_size + 1)
    except BotoCoreError:
        raise StorageUnavailable("The report storage service could not complete the request.") from None
    if len(content) != expected_size:
        raise StorageUnavailable("The stored report size differs from its registered size.")
    return content


def delete(key: str) -> None:
    _request("delete_object", key)


def validate_configuration() -> None:
    if configured_backend() == "object":
        _bucket()
