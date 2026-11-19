FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY mwl_scp.py .
EXPOSE 4243
CMD ["python", "-u", "mwl_scp.py"]
